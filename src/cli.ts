#!/usr/bin/env node

/**
 * Pinmoli CLI Entry Point
 * Standalone SIP testing agent built with pi libraries
 */

import { PinmoliTUI } from './ui/tui.js';
import { PinmoliAgent } from './agent/runtime.js';
import { configureServiceAccount, isVertexConfigured } from './commands/service-account.js';
import type { Config } from './validation/schemas.js';

// Default configuration — google-vertex with deferred credentials
const config: Config = {
  llm: {
    provider: 'google-vertex',
    model: 'gemini-2.5-flash'
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

/**
 * Handle slash commands. Returns true if input was a slash command.
 */
function handleSlashCommand(input: string, agent: PinmoliAgent, tui: PinmoliTUI): boolean {
  const match = input.match(/^\/service-account\s+(.+)$/);
  if (match) {
    const result = configureServiceAccount(match[1].trim());
    if (result.success) {
      agent.switchModel(config.llm.provider, config.llm.model);
      tui.addMessage('system', result.message);
    } else {
      tui.addMessage('system', `Error: ${result.message}`);
    }
    return true;
  }
  return false;
}

function parseArgs(): { serviceAccount?: string } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--service-account' && args[i + 1]) {
      return { serviceAccount: args[i + 1] };
    }
  }
  return {};
}

async function main() {
  console.log('Pinmoli - SIP Testing Agent');
  console.log('Version 0.1.0\n');

  // Handle --service-account flag
  const args = parseArgs();
  if (args.serviceAccount) {
    const result = configureServiceAccount(args.serviceAccount);
    if (result.success) {
      console.log(result.message + '\n');
    } else {
      console.error(`Error: ${result.message}`);
      process.exit(1);
    }
  }

  // Non-fatal warning if Vertex isn't configured yet
  if (!isVertexConfigured()) {
    console.log('Vertex AI not configured. Use --service-account <path> or /service-account <path>.\n');
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

      // Handle slash commands before sending to agent
      if (input.startsWith('/') && handleSlashCommand(input, agent, tui)) {
        continue;
      }

      // Check credentials before LLM call
      if (!isVertexConfigured()) {
        tui.addMessage('system', 'Vertex AI not configured. Run /service-account <path-to-json> first.');
        continue;
      }

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
