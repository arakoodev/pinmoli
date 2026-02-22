/**
 * Pinmoli Agent Runtime
 * Wires pi-agent-core to TUI
 */

import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import type { Config } from '../validation/schemas.js';
import { registerAllTools, getAllTools } from '../tools/index.js';

const SYSTEM_PROMPT = `
You are Pinmoli, a SIP/WebRTC testing assistant. You ONLY help test voice protocols.

You CANNOT:
- Edit files
- Run bash commands
- Install packages
- Access file system (except ~/.pinmoli/)
- Help with general coding

You CAN ONLY:
- Run SIP tests (OPTIONS, INVITE, REGISTER)
- Analyze SIP failures
- Save/load test configurations
- Explain SIP/RTP/WebRTC concepts

If asked to do anything else, politely decline.
`;

export class PinmoliAgent {
  private agent: Agent;
  private model: any;
  private tui?: any;

  constructor(config: Config, tui?: any) {
    this.tui = tui;
    
    // Register all SIP tools
    registerAllTools();
    const tools = getAllTools();

    // Get LLM model
    this.model = getModel(config.llm.provider as any, config.llm.model);

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
    this.agent.subscribe((event) => {
      if (event.type === 'tool_execution_start') {
        if (this.tui) {
          this.tui.streamMessage(`\n[Tool] Executing ${event.toolName}...`);
        }
      } else if (event.type === 'tool_execution_update') {
        // Stream tool updates to TUI
        if (this.tui && event.partialResult?.content) {
          const text = event.partialResult.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');
          if (text) {
            this.tui.streamMessage(`\n  ${text}`);
          }
        }
      } else if (event.type === 'tool_execution_end') {
        if (this.tui) {
          this.tui.streamMessage('\n[Tool] Complete\n');
        }
      }
    });
  }

  /**
   * Send a message to the agent
   */
  async chat(message: string): Promise<string> {
    await this.agent.prompt(message);
    
    // Get the last assistant message
    const state = this.agent.state;
    const lastMessage = state.messages[state.messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant') {
      const textContent = lastMessage.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
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
