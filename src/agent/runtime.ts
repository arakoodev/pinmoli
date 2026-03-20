/**
 * Pinmoli Agent Runtime
 * Wires pi-agent-core to TUI
 */

import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import type { Model, KnownProvider, TextContent, AssistantMessage } from '@mariozechner/pi-ai';
import type { Config } from '../validation/schemas.js';
import { registerAllTools, getAllTools } from '../tools/index.js';

/** Minimal TUI interface used by the agent runtime */
interface TuiLike {
  startThinking(): void;
  stopThinking(): void;
  startAssistantStream(): void;
  appendAssistantStream(text: string): void;
  endAssistantStream(): void;
  streamMessage(text: string): void;
  onToolStart(toolName: string): void;
  onToolEnd(): void;
}

const SYSTEM_PROMPT = `
You are Pinmoli, a SIP/WebRTC testing assistant. You ONLY help test voice protocols.

You CANNOT:
- Edit files
- Run bash commands
- Install packages
- Access file system (except ~/.pinmoli/)
- Help with general coding

You CAN ONLY:
- Run SIP tests (OPTIONS, INVITE, REGISTER) via sip_test
- Run WebRTC tests (WHIP connect, audio send/receive) via webrtc_test
- Analyze failures (SIP and WebRTC)
- Save/load test configurations
- Explain SIP/RTP/WebRTC concepts

## Pre-flight Validation Rules

Before calling sip_test, validate and confirm parameters with the user:

**URI Validation:**
- LiveKit (*.sip.livekit.cloud): URI MUST include a phone number (sip:+1XXXXXXXXXX@host). If the user provides a bare host, ask for the phone number — bare host returns 404.
- Other endpoints: Bare sip:host is OK for OPTIONS; user part recommended for INVITE/REGISTER.

**Method-specific checks:**
- OPTIONS: URI is the main requirement. Defaults are fine for codecs/transport.
- INVITE: Confirm audio sample. Recommend sendDelay: 8 for voice agents that speak first. Mention responseWaitTime if relevant.
- REGISTER: Ask about auth credentials (username/password).

**Codec selection (all four supported):**
- opus — modern, good quality, preferred by WebRTC
- PCMU — G.711 mu-law, most widely supported SIP codec
- PCMA — G.711 A-law, common in Europe/international
- G722 — wideband (16kHz), higher quality than G.711
When the user says "G.711" they mean PCMU or PCMA. When they say "G722" or "g722" use "G722".

**WebRTC Pre-flight Validation:**
- WHIP endpoint must be an HTTPS URL (or HTTP for local dev)
- Bearer token required for authenticated endpoints (LiveKit, Cloudflare)
- Recommend codec: opus for most platforms
- Recommend sendDelay: 5-8 for voice agents that speak first

**When to skip confirmation (do NOT over-ask):**
- User explicitly provided all required parameters → proceed immediately.
- User said "just run it", "use defaults", or similar → proceed with defaults.
- Re-running a previously saved/loaded test → skip questions.

**Response format:** Be concise, max 2-3 questions per message. Example:
"Before I run this test, a couple of things:
1. That's a LiveKit endpoint — what phone number should I call? (e.g., +15551234567)
2. Should I listen for the agent's greeting first? (I'd recommend sendDelay: 8)"

If asked to do anything else, politely decline.
`;

function isTextContent(c: unknown): c is TextContent {
  return typeof c === 'object' && c !== null && (c as TextContent).type === 'text';
}

export class PinmoliAgent {
  private agent: Agent;
  private model: Model<string>;
  private tui?: TuiLike;
  private streamedToTui = false;

  constructor(config: Config, tui?: TuiLike) {
    this.tui = tui;

    // Register all SIP tools
    registerAllTools();
    const tools = getAllTools();

    // Get LLM model
    this.model = getModel(
      config.llm.agent.provider as KnownProvider,
      config.llm.agent.model as never,
    );

    // Create agent
    this.agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        tools
      }
    });

    // Set model and tools
    this.agent.setModel(this.model);
    this.agent.setTools(tools);

    // Subscribe to events and stream to TUI
    this.agent.subscribe((event: AgentEvent) => {
      if (event.type === 'message_start') {
        const msg = event.message as AssistantMessage | undefined;
        if (this.tui && msg?.role === 'assistant') {
          this.tui.stopThinking();
          this.tui.startAssistantStream();
          this.streamedToTui = true;
        }
      } else if (event.type === 'message_update') {
        const ame = event.assistantMessageEvent;
        if (this.tui && ame?.type === 'text_delta') {
          this.tui.appendAssistantStream(ame.delta);
        }
      } else if (event.type === 'message_end') {
        const msg = event.message as AssistantMessage | undefined;
        if (this.tui && msg?.role === 'assistant') {
          this.tui.endAssistantStream();
        }
      } else if (event.type === 'tool_execution_start') {
        if (this.tui) {
          this.tui.onToolStart(event.toolName);
        }
      } else if (event.type === 'tool_execution_update') {
        // Stream tool updates to TUI
        if (this.tui && event.partialResult?.content) {
          const text = (event.partialResult.content as unknown[])
            .filter(isTextContent)
            .map(c => c.text)
            .join('');
          if (text) {
            this.tui.streamMessage(text);
          }
        }
      } else if (event.type === 'tool_execution_end') {
        if (this.tui) {
          this.tui.onToolEnd();
        }
      }
    });
  }

  /**
   * Switch to a different LLM provider/model at runtime
   */
  switchModel(provider: string, modelId: string): void {
    this.model = getModel(provider as KnownProvider, modelId as never);
    this.agent.setModel(this.model);
  }

  /**
   * Abort in-flight agent work (cancels LLM stream and tool execution)
   */
  abort(): void {
    this.agent.abort();
  }

  /**
   * Send a message to the agent
   */
  async chat(message: string): Promise<string> {
    this.streamedToTui = false;
    this.tui?.startThinking();
    await this.agent.prompt(message);
    this.tui?.stopThinking();

    // Check for errors
    const state = this.agent.state;
    if (state.error) {
      return `Error: ${state.error}`;
    }

    // If text was already streamed to TUI, don't return it again
    if (this.streamedToTui) {
      return '';
    }

    // Fallback: extract from state
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && 'role' in lastMessage && lastMessage.role === 'assistant') {
      const assistantMsg = lastMessage as AssistantMessage;
      const textContent = assistantMsg.content
        .filter(isTextContent)
        .map(c => c.text)
        .join('\n');
      return textContent;
    }

    return '';
  }

  /**
   * Get conversation state
   */
  getState() {
    return this.agent.state;
  }
}
