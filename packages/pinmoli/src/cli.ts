#!/usr/bin/env node

/**
 * Pinmoli CLI Entry Point
 * Standalone SIP testing agent built with pi libraries
 */

import { PinmoliTUI } from './ui/tui.js';
import { PinmoliAgent } from './agent/runtime.js';
import type { Config } from './validation/schemas.js';

// Default configuration
const config: Config = {
  llm: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    apiKey: process.env.ANTHROPIC_API_KEY
  },
  sip: {
    defaultPort: 5060,
    timeout: 30000,
    maxDuration: 300
  },
  ui: {
    maxTimelineEvents: 1000
  }
};

async function main() {
  console.log('Pinmoli - SIP Testing Agent');
  console.log('Version 0.1.0\n');

  // Check for API key
  if (!config.llm.apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    console.error('Please set it: export ANTHROPIC_API_KEY=your-key');
    process.exit(1);
  }

  console.log('Initializing agent...');

  let tui: PinmoliTUI | undefined;
  try {
    tui = new PinmoliTUI();
    const agent = new PinmoliAgent(config, tui);

    console.log('✓ Ready\n');

    tui.start();

    // Wire Ctrl+C / Escape interrupt to agent abort
    tui.onInterrupt = () => agent.abort();

    // REPL loop
    while (true) {
      const input = await tui.getUserInput();

      if (!input) continue;
      if (input === 'exit' || input === 'quit') break;

      tui.addMessage('user', input);
      tui.setAgentBusy(true);

      try {
        const response = await agent.chat(input);
        if (response) {
          tui.addMessage('assistant', response);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Don't show abort as an error — it's expected user action
        if (!errorMsg.includes('aborted')) {
          tui.addMessage('assistant', `Error: ${errorMsg}`);
        }
      } finally {
        tui.setAgentBusy(false);
      }
    }

    tui.stop();
    console.log('\nGoodbye!');
  } catch (error) {
    tui?.stop();
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
}

main().catch(console.error);
