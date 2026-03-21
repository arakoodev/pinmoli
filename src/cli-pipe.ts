#!/usr/bin/env node

/**
 * Pinmoli Pipe Mode — non-interactive chat harness.
 *
 * Reads one message per line from stdin, sends to the agent,
 * streams responses to stdout. Tool output and status go to stderr
 * (same as the TUI mode — stderr tee is built into PinmoliTUI).
 *
 * Usage:
 *   echo "test sip:+1234567890@host with OPTIONS" | npx tsx src/cli-pipe.ts
 *   npx tsx src/cli-pipe.ts <<< "list my saved tests"
 *   npx tsx src/cli-pipe.ts          # interactive line mode (type + Enter)
 */

import { createInterface } from 'readline';
import { PinmoliAgent } from './agent/runtime.js';
import { isVertexConfigured } from './commands/service-account.js';
import { initCliSession, initManifest } from './network/session.js';
import { terminateAll } from './sip/call-store.js';
import { getEnvApiKey } from '@mariozechner/pi-ai';
import type { KnownProvider } from '@mariozechner/pi-ai';
import type { Config } from './validation/schemas.js';

/**
 * Minimal TUI for pipe mode. Agent text streams to stdout.
 * Tool output, status, and the same text also go to stderr
 * (for parity with the real TUI which tees everything to stderr).
 */
const pipeTui = {
  startThinking() { process.stderr.write('[thinking...]\n'); },
  stopThinking() {},
  startAssistantStream() {},
  appendAssistantStream(text: string) {
    process.stdout.write(text);
    process.stderr.write(text);
  },
  endAssistantStream() {
    process.stdout.write('\n');
    process.stderr.write('\n');
  },
  streamMessage(text: string) { process.stderr.write(text); },
  onToolStart(name: string) { process.stderr.write(`[tool:${name}]\n`); },
  onToolEnd() { process.stderr.write('[tool:done]\n'); },
};

const PROVIDER_DEFAULTS: Record<string, { model: string; envVar: string; display: string }> = {
  'anthropic':    { model: 'claude-sonnet-4-5',        envVar: 'ANTHROPIC_API_KEY',  display: 'Anthropic' },
  'openai':       { model: 'gpt-4o',                   envVar: 'OPENAI_API_KEY',     display: 'OpenAI' },
  'google':       { model: 'gemini-2.5-flash',         envVar: 'GEMINI_API_KEY',     display: 'Google Gemini' },
  'google-vertex':{ model: 'gemini-2.5-pro',            envVar: '(service account)',   display: 'Google Vertex AI' },
  'groq':         { model: 'llama-3.3-70b-versatile',  envVar: 'GROQ_API_KEY',       display: 'Groq' },
  'openrouter':   { model: 'anthropic/claude-sonnet-4.5', envVar: 'OPENROUTER_API_KEY', display: 'OpenRouter' },
};

function autoDetectProvider(): string | undefined {
  for (const provider of ['anthropic', 'openai', 'google', 'google-vertex', 'groq', 'openrouter']) {
    if (provider === 'google-vertex' ? isVertexConfigured() : !!getEnvApiKey(provider as KnownProvider)) {
      return provider;
    }
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  let providerArg: string | undefined;
  let modelArg: string | undefined;
  let ttsModelArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') providerArg = args[++i];
    if (args[i] === '--model') modelArg = args[++i];
    if (args[i] === '--tts-model') ttsModelArg = args[++i];
  }

  const provider = providerArg ?? autoDetectProvider();
  if (!provider) {
    process.stderr.write('No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.\n');
    process.exit(1);
  }

  const model = modelArg ?? PROVIDER_DEFAULTS[provider]?.model ?? 'gemini-2.5-flash';
  const config: Config = {
    llm: {
      agent: { provider: provider as Config['llm']['agent']['provider'], model },
      ...(provider === 'google-vertex' ? { tts: { model: ttsModelArg || 'gemini-2.5-flash-tts' } } : {}),
    },
    sip: { defaultPort: 5060, timeout: 30000, maxDuration: 300 },
    ui: { maxTimelineEvents: 1000 },
  };

  // Create CLI session directory — all output scoped under it
  const sessionRoot = initCliSession();
  initManifest(provider, model);
  process.stderr.write(`Pinmoli pipe mode — ${PROVIDER_DEFAULTS[provider]?.display ?? provider} / ${model}\n`);
  process.stderr.write(`Session: ${sessionRoot}\n`);

  // Clean up active interactive calls on exit
  const cleanup = async () => { try { await terminateAll(); } catch { /* best-effort */ } };
  process.on('beforeExit', cleanup);
  process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });

  const agent = new PinmoliAgent(config, pipeTui);

  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const msg = line.trim();
    if (!msg) continue;
    if (msg === 'exit' || msg === 'quit') break;

    process.stderr.write(`> ${msg}\n`);

    try {
      const response = await agent.chat(msg);
      if (response) {
        process.stdout.write(response + '\n');
        process.stderr.write(response + '\n');
      }
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

main().catch(err => { process.stderr.write(`Fatal: ${err}\n`); process.exit(1); });
