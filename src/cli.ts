#!/usr/bin/env node

/**
 * Pinmoli CLI Entry Point
 * Standalone SIP/WebRTC testing agent built with pi libraries
 */

import { PinmoliTUI } from './ui/tui.js';
import { PinmoliAgent } from './agent/runtime.js';
import { configureServiceAccount, isVertexConfigured } from './commands/service-account.js';
import { getEnvApiKey } from '@mariozechner/pi-ai';
import type { KnownProvider } from '@mariozechner/pi-ai';
import type { Config } from './validation/schemas.js';

/** Supported providers and their default models */
const PROVIDER_DEFAULTS: Record<string, { model: string; envVar: string; display: string }> = {
  'anthropic':    { model: 'claude-sonnet-4-5',        envVar: 'ANTHROPIC_API_KEY',  display: 'Anthropic' },
  'openai':       { model: 'gpt-4o',                   envVar: 'OPENAI_API_KEY',     display: 'OpenAI' },
  'google':       { model: 'gemini-2.5-flash',         envVar: 'GEMINI_API_KEY',     display: 'Google Gemini' },
  'google-vertex':{ model: 'gemini-2.5-flash',         envVar: '(service account)',   display: 'Google Vertex AI' },
  'groq':         { model: 'llama-3.3-70b-versatile',  envVar: 'GROQ_API_KEY',       display: 'Groq' },
  'openrouter':   { model: 'anthropic/claude-sonnet-4.5', envVar: 'OPENROUTER_API_KEY', display: 'OpenRouter' },
};

const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_DEFAULTS);

type SupportedProvider = 'anthropic' | 'openai' | 'google' | 'google-vertex' | 'groq' | 'openrouter';

function isSupportedProvider(p: string): p is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(p);
}

interface CliArgs {
  provider?: string;
  model?: string;
  serviceAccount?: string;
  help?: boolean;
}

function printUsage() {
  console.log(`Usage: pinmoli [options]

Options:
  --provider <name>          LLM provider (${SUPPORTED_PROVIDERS.join(', ')})
  --model <id>               Model ID (default depends on provider)
  --service-account <path>   GCP service account JSON (for google-vertex)
  --help                     Show this message

Environment variables (set the one matching your provider):
  ANTHROPIC_API_KEY          Anthropic API key
  OPENAI_API_KEY             OpenAI API key
  GEMINI_API_KEY             Google Gemini API key
  GROQ_API_KEY               Groq API key
  OPENROUTER_API_KEY         OpenRouter API key

For Vertex AI, use --service-account or set:
  GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION

If --provider is omitted, Pinmoli auto-detects from available env vars.

Examples:
  ANTHROPIC_API_KEY=sk-ant-... pinmoli
  pinmoli --provider openai --model gpt-4o
  pinmoli --service-account /path/to/key.json
  pinmoli --provider google
`);
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--provider':
        result.provider = args[++i];
        break;
      case '--model':
        result.model = args[++i];
        break;
      case '--service-account':
        result.serviceAccount = args[++i];
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  return result;
}

/**
 * Auto-detect provider from environment variables.
 * Checks in order of preference: Anthropic, OpenAI, Google Gemini, Vertex, Groq, OpenRouter.
 */
function autoDetectProvider(): string | undefined {
  const order = ['anthropic', 'openai', 'google', 'google-vertex', 'groq', 'openrouter'];
  for (const provider of order) {
    if (isProviderConfigured(provider)) {
      return provider;
    }
  }
  return undefined;
}

/**
 * Check if the given provider has valid credentials available.
 *
 * For google-vertex we check our own env vars directly because pi-ai's
 * getEnvApiKey uses async dynamic imports for node:fs/os/path that may
 * not have resolved yet — its cache returns false permanently on first
 * call if the imports haven't settled.
 */
function isProviderConfigured(provider: string): boolean {
  if (provider === 'google-vertex') {
    return isVertexConfigured();
  }
  return !!getEnvApiKey(provider as KnownProvider);
}

/**
 * Handle slash commands. Returns true if input was a slash command.
 */
function handleSlashCommand(input: string, agent: PinmoliAgent, tui: PinmoliTUI, config: Config): boolean {
  // /service-account <path> — configure Vertex AI
  const saMatch = input.match(/^\/service-account\s+(.+)$/);
  if (saMatch) {
    const result = configureServiceAccount(saMatch[1].trim());
    if (result.success) {
      config.llm.provider = 'google-vertex';
      config.llm.model = PROVIDER_DEFAULTS['google-vertex'].model;
      agent.switchModel(config.llm.provider, config.llm.model);
      tui.addMessage('system', result.message);
    } else {
      tui.addMessage('system', `Error: ${result.message}`);
    }
    return true;
  }

  // /model <provider> [model] — switch provider/model at runtime
  const modelMatch = input.match(/^\/model\s+(\S+)\s*(.*)$/);
  if (modelMatch) {
    const newProvider = modelMatch[1];
    const newModel = modelMatch[2]?.trim();

    if (!isSupportedProvider(newProvider)) {
      tui.addMessage('system', `Unknown provider: ${newProvider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
      return true;
    }

    if (newProvider === 'google-vertex' && !isProviderConfigured('google-vertex')) {
      tui.addMessage('system', 'Vertex AI not configured. Use /service-account <path> first.');
      return true;
    }

    if (newProvider !== 'google-vertex' && !isProviderConfigured(newProvider)) {
      const info = PROVIDER_DEFAULTS[newProvider];
      tui.addMessage('system', `${info.display} not configured. Set ${info.envVar} environment variable.`);
      return true;
    }

    const modelId = newModel || PROVIDER_DEFAULTS[newProvider].model;
    config.llm.provider = newProvider;
    config.llm.model = modelId;
    agent.switchModel(newProvider, modelId);
    tui.addMessage('system', `Switched to ${PROVIDER_DEFAULTS[newProvider].display}: ${modelId}`);
    return true;
  }

  // /model (no args) — show current model
  if (input === '/model') {
    const info = PROVIDER_DEFAULTS[config.llm.provider];
    tui.addMessage('system', `Current: ${info?.display || config.llm.provider} / ${config.llm.model}`);
    return true;
  }

  return false;
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  console.log('Pinmoli - SIP/WebRTC Testing Agent');
  console.log('Version 0.2.0\n');

  // Handle --service-account (implies google-vertex)
  if (args.serviceAccount) {
    const result = configureServiceAccount(args.serviceAccount);
    if (result.success) {
      console.log(result.message + '\n');
      // If no explicit --provider, default to vertex
      if (!args.provider) {
        args.provider = 'google-vertex';
      }
    } else {
      console.error(`Error: ${result.message}`);
      process.exit(1);
    }
  }

  // Resolve provider: explicit flag > auto-detect > error
  let provider = args.provider;
  if (!provider) {
    provider = autoDetectProvider();
    if (provider) {
      const info = PROVIDER_DEFAULTS[provider];
      console.log(`Auto-detected provider: ${info.display} (${info.envVar})\n`);
    }
  }

  if (!provider) {
    console.error('No LLM provider configured.\n');
    console.error('Set one of these environment variables:');
    console.error('  ANTHROPIC_API_KEY    — Anthropic (Claude)');
    console.error('  OPENAI_API_KEY       — OpenAI (GPT)');
    console.error('  GEMINI_API_KEY       — Google Gemini');
    console.error('  GROQ_API_KEY         — Groq');
    console.error('  OPENROUTER_API_KEY   — OpenRouter');
    console.error('\nOr use: pinmoli --service-account <path.json> for Google Vertex AI');
    console.error('\nRun pinmoli --help for full usage.');
    process.exit(1);
  }

  if (!isSupportedProvider(provider)) {
    console.error(`Unknown provider: ${provider}`);
    console.error(`Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    process.exit(1);
  }

  // Check credentials
  if (!isProviderConfigured(provider)) {
    const info = PROVIDER_DEFAULTS[provider];
    if (provider === 'google-vertex') {
      console.error('Vertex AI not configured. Use --service-account <path.json>');
    } else {
      console.error(`${info.display} API key not found. Set ${info.envVar} environment variable.`);
    }
    process.exit(1);
  }

  const model = args.model || PROVIDER_DEFAULTS[provider].model;

  // Build config
  const config: Config = {
    llm: { provider, model },
    sip: { defaultPort: 5060, timeout: 30000, maxDuration: 300 },
    ui: { maxTimelineEvents: 1000 }
  };

  const info = PROVIDER_DEFAULTS[provider];
  console.log(`Provider: ${info.display}`);
  console.log(`Model: ${model}`);
  console.log('Initializing agent...');

  let tui: PinmoliTUI | undefined;
  try {
    tui = new PinmoliTUI();
    const agent = new PinmoliAgent(config, tui);

    console.log('Ready\n');

    tui.start();

    // Wire Ctrl+C / Escape interrupt to agent abort
    tui.onInterrupt = () => agent.abort();

    // REPL loop
    while (true) {
      const input = await tui.getUserInput();

      if (!input) continue;
      if (input === 'exit' || input === 'quit') break;

      // Handle slash commands before sending to agent
      if (input.startsWith('/') && handleSlashCommand(input, agent, tui, config)) {
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
