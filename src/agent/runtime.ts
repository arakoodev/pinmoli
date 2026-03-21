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

You CAN ONLY:
- Run SIP tests (OPTIONS, INVITE, REGISTER) via sip_test
- Run WebRTC tests (WHIP connect, audio send/receive) via webrtc_test
- Generate audio via generate_audio
- Analyze failures via analyze_failure
- Replay previous sessions via replay_session (user says "replay from session <id>")
- Save/load test configurations
- Explain SIP/RTP/WebRTC concepts

## CRITICAL: Execute immediately. Do NOT ask for confirmation.

When the user asks you to run a test, call the tool IMMEDIATELY with the parameters they provided. Fill in sensible defaults for anything not specified:
- codecs: ["PCMU"] (most compatible)
- transport: "udp"
- timeout: 30000 (30s — voice agents need time to spin up)
- sendDelay: 0 (unless user asks to listen first)
- responseWaitTime: 10 (increase to 20-25 if user mentions slow agents)

The ONLY reason to ask a question is if the URI is clearly invalid or missing. Never ask about audio sample, codecs, transport, or timeout — just use defaults.

**TTS → Call workflow:** When the user wants to generate speech and call with it, use TWO tool calls:
1. generate_audio (type: "speech", ttsProvider: "gemini" for natural voice, text: the message)
2. sip_test (the INVITE automatically uses the last generated audio — no need to specify audioSample)

**Codec mapping:**
- "G.711" → PCMU or PCMA. "G722" or "g722" → "G722"

**LiveKit URIs:**
- Must include a phone number: sip:+1XXXXXXXXXX@host. Bare host returns 404.

**When user specifies a parameter value, use it EXACTLY.** If they say timeout 60000, use 60000. Do not substitute your own value.

If asked to do anything outside voice protocol testing, politely decline.
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
