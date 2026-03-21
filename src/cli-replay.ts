#!/usr/bin/env node

/**
 * Pinmoli Replay Mode — re-execute a recorded session without LLM.
 *
 * Reads manifest.json from a previous session, loads flow.json from each
 * test directory, re-runs each tool call with the same parameters, then
 * compares the replay flow against the original.
 *
 * Usage:
 *   npx tsx src/cli-replay.ts <session-path>
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, basename } from 'path';
import { initCliSession, initManifest, getSessionRoot } from './network/session.js';
import { readFlowJson, formatFlow, compareFlows } from './network/flow.js';
import type { FlowRecord } from './network/flow.js';
import { registerAllTools, getAllTools } from './tools/index.js';
import type { SessionManifest } from './network/session.js';

async function main() {
  const sessionPath = process.argv[2];
  if (!sessionPath || sessionPath === '--help' || sessionPath === '-h') {
    process.stderr.write(`Pinmoli Replay — re-execute a recorded session without LLM

Usage:
  npx tsx src/cli-replay.ts <session-path>

Example:
  npx tsx src/cli-replay.ts captures/20260320-065054-tw1x

The session directory must contain a manifest.json (auto-created by Pinmoli).
Original flows are loaded from flow.json in each test subdirectory.
Results are written to a new session directory under captures/.
`);
    process.exit(sessionPath ? 0 : 1);
  }

  const absPath = resolve(sessionPath);
  const manifestFile = resolve(absPath, 'manifest.json');

  if (!existsSync(manifestFile)) {
    process.stderr.write(`Error: No manifest.json in ${absPath}\n`);
    process.stderr.write(`Session replay requires a manifest. Run a session first with cli.ts or cli-pipe.ts.\n`);
    process.exit(1);
  }

  const manifest: SessionManifest = JSON.parse(readFileSync(manifestFile, 'utf-8'));

  if (!manifest.steps || manifest.steps.length === 0) {
    process.stderr.write(`Error: manifest.json has no steps to replay.\n`);
    process.exit(1);
  }

  // ---- Load original flows from flow.json in test directories ----
  const originalFlows = new Map<number, FlowRecord>();
  for (let i = 0; i < manifest.steps.length; i++) {
    const step = manifest.steps[i];
    if (step.testDir) {
      const testDirPath = resolve(absPath, step.testDir);
      const flow = readFlowJson(testDirPath);
      if (flow) originalFlows.set(i, flow);
    }
  }

  process.stderr.write(`Pinmoli Replay\n`);
  process.stderr.write(`Original: ${basename(absPath)} (${manifest.steps.length} steps)\n`);
  if (manifest.provider) {
    process.stderr.write(`Provider: ${manifest.provider} / ${manifest.model}\n`);
  }
  process.stderr.write(`Flows loaded: ${originalFlows.size} test(s) with flow.json\n`);

  // ---- Create replay session ----
  const replayRoot = initCliSession();
  initManifest(manifest.provider, manifest.model);

  // Copy audio-samples/ from source session so replay can find generated TTS files
  const srcAudio = resolve(absPath, 'audio-samples');
  if (existsSync(srcAudio)) {
    const dstAudio = resolve(replayRoot, 'audio-samples');
    mkdirSync(dstAudio, { recursive: true });
    const audioFiles = readdirSync(srcAudio).filter(f => f.endsWith('.wav'));
    for (const file of audioFiles) {
      copyFileSync(resolve(srcAudio, file), resolve(dstAudio, file));
    }
    if (audioFiles.length > 0) {
      process.stderr.write(`Copied ${audioFiles.length} audio sample(s) from source session\n`);
    }
  }

  process.stderr.write(`\nReplay:   ${replayRoot}\n\n`);

  // Register tools
  registerAllTools();
  const tools = getAllTools();
  const toolMap = new Map(tools.map(t => [t.name, t]));

  let passed = 0;
  let failed = 0;
  const replayFlows = new Map<number, FlowRecord>();

  for (let i = 0; i < manifest.steps.length; i++) {
    const step = manifest.steps[i];
    const tool = toolMap.get(step.tool);

    if (!tool) {
      process.stderr.write(`[${i + 1}/${manifest.steps.length}] SKIP: unknown tool "${step.tool}"\n`);
      failed++;
      continue;
    }

    // Show what we're replaying
    const paramSummary = summarizeParams(step.tool, step.params);
    process.stderr.write(`--- Step ${i + 1}/${manifest.steps.length}: ${step.tool} ${paramSummary} ---\n`);

    // Show original flow if available
    const origFlow = originalFlows.get(i);
    if (origFlow) {
      process.stderr.write(`  Original flow:\n`);
      process.stderr.write(formatFlow(origFlow) + '\n');
      process.stderr.write(`\n`);
    }

    const startTime = Date.now();

    try {
      const result = await tool.execute(
        `replay-${i + 1}`,
        step.params,
        new AbortController().signal,
        (update) => {
          if (update?.content) {
            const text = (update.content as Array<{ type: string; text?: string }>)
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('');
            if (text) process.stderr.write(text);
          }
        },
      );

      const elapsed = Date.now() - startTime;

      const resultText = (result.content as Array<{ type: string; text?: string }>)
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');

      const success = !(result.details && typeof result.details === 'object' && 'error' in result.details);

      // Load replay flow.json if the tool produced one
      if (result.details && typeof result.details === 'object' && 'testDir' in result.details) {
        const replayTestDir = result.details.testDir as string;
        const replayRoot = getSessionRoot();
        const replayFlow = readFlowJson(resolve(replayRoot, replayTestDir));
        if (replayFlow) replayFlows.set(i, replayFlow);
      }

      // Show replay flow and comparison
      const replayFlow = replayFlows.get(i);
      if (replayFlow) {
        process.stderr.write(`\n  Replay flow:\n`);
        process.stderr.write(formatFlow(replayFlow) + '\n');

        if (origFlow) {
          process.stderr.write(`\n`);
          process.stderr.write(compareFlows(origFlow, replayFlow) + '\n');
        }
      } else if (origFlow) {
        // No replay flow but had original — show timing comparison
        const diff = elapsed - step.durationMs;
        const sign = diff >= 0 ? '+' : '';
        process.stderr.write(`  Replay duration: ${(elapsed / 1000).toFixed(1)}s (${sign}${(diff / 1000).toFixed(1)}s vs original)\n`);
      }

      if (success) {
        process.stderr.write(`  PASS\n`);
        passed++;
      } else {
        process.stderr.write(`  FAIL\n`);
        failed++;
      }

      process.stdout.write(resultText + '\n');
    } catch (error) {
      process.stderr.write(`  ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
      failed++;
    }

    process.stderr.write('\n');
  }

  process.stderr.write(`Replay complete: ${passed} passed, ${failed} failed\n`);
  process.stderr.write(`Results: ${replayRoot}\n`);
}

/** Short summary of tool params for display */
function summarizeParams(tool: string, params: Record<string, unknown>): string {
  switch (tool) {
    case 'sip_test':
      return `${params.method} ${params.uri}`;
    case 'webrtc_test':
      return String(params.whipEndpoint || '');
    case 'generate_audio':
      return `${params.type} "${params.filename}"${params.ttsProvider ? ` (${params.ttsProvider})` : ''}`;
    case 'save_test':
      return `"${params.name}"`;
    case 'load_test':
      return `"${params.name}"`;
    default:
      return '';
  }
}

main().catch(err => { process.stderr.write(`Fatal: ${err}\n`); process.exit(1); });
