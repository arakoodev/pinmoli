/**
 * Replay Session Tool
 * Re-executes a recorded session's tool calls, reusing audio samples.
 */

import { Type } from '@sinclair/typebox';
import { readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, basename } from 'path';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { getSessionRoot } from '../network/session.js';
import { registerAllTools, getAllTools } from './index.js';
import type { SessionManifest } from '../network/session.js';

/**
 * Find a session directory by full name, partial match, or suffix.
 * Searches captures/ under the current working directory.
 */
function findSession(sessionId: string): string | null {
  // Direct path
  if (existsSync(resolve(sessionId, 'manifest.json'))) {
    return resolve(sessionId);
  }

  // Under captures/
  const capturesDir = resolve(process.cwd(), 'captures');
  const direct = resolve(capturesDir, sessionId);
  if (existsSync(resolve(direct, 'manifest.json'))) {
    return direct;
  }

  // Fuzzy match — find directories containing the sessionId
  if (!existsSync(capturesDir)) return null;
  const dirs = readdirSync(capturesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.includes(sessionId))
    .map(d => d.name)
    .sort()
    .reverse();

  for (const dir of dirs) {
    if (existsSync(resolve(capturesDir, dir, 'manifest.json'))) {
      return resolve(capturesDir, dir);
    }
  }

  return null;
}

/**
 * Copy audio-samples/ from source session to current session.
 */
function copyAudioSamples(sourceDir: string): number {
  const srcAudio = resolve(sourceDir, 'audio-samples');
  if (!existsSync(srcAudio)) return 0;

  const dstAudio = resolve(getSessionRoot(), 'audio-samples');
  mkdirSync(dstAudio, { recursive: true });

  const files = readdirSync(srcAudio).filter(f => f.endsWith('.wav'));
  for (const file of files) {
    const src = resolve(srcAudio, file);
    const dst = resolve(dstAudio, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
    }
  }
  return files.length;
}

export const replaySessionTool: AgentTool = {
  name: 'replay_session',
  label: 'Replay Session',
  description: `Re-execute all tool calls from a previous session. Copies audio samples and runs each step with the original parameters. Use when the user says "replay from session <id>". The session ID can be a full directory name (e.g. "20260321-103204-j7a2") or a partial match (e.g. "j7a2").`,
  parameters: Type.Object({
    sessionId: Type.String({
      description: 'Session directory name or partial match. Example: "20260321-103204-j7a2" or just "j7a2".',
    }),
  }),

  async execute(toolCallId, params, signal, onUpdate) {
    const { sessionId } = params as { sessionId: string };

    // Find the source session
    const sourceDir = findSession(sessionId);
    if (!sourceDir) {
      return {
        content: [{ type: 'text', text: `Session not found: ${sessionId}. Check captures/ for available sessions.` }],
        details: {},
      };
    }

    const manifestPath = resolve(sourceDir, 'manifest.json');
    const manifest: SessionManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    if (!manifest.steps || manifest.steps.length === 0) {
      return {
        content: [{ type: 'text', text: `Session ${basename(sourceDir)} has no steps to replay.` }],
        details: {},
      };
    }

    // Copy audio samples from source session to current session
    const copiedCount = copyAudioSamples(sourceDir);

    const lines: string[] = [];
    lines.push(`Replaying session: ${basename(sourceDir)} (${manifest.steps.length} steps)`);
    if (copiedCount > 0) {
      lines.push(`Copied ${copiedCount} audio sample(s) from source session`);
    }

    onUpdate?.({ content: [{ type: 'text', text: lines.join('\n') }], details: {} });

    // Get registered tools
    const tools = getAllTools();
    const toolMap = new Map(tools.map(t => [t.name, t]));

    let passed = 0;
    let failed = 0;
    const results: string[] = [];

    for (let i = 0; i < manifest.steps.length; i++) {
      if (signal?.aborted) break;

      const step = manifest.steps[i];
      const tool = toolMap.get(step.tool);

      if (!tool) {
        const msg = `Step ${i + 1}: SKIP — unknown tool "${step.tool}"`;
        results.push(msg);
        onUpdate?.({ content: [{ type: 'text', text: msg }], details: {} });
        failed++;
        continue;
      }

      const paramSummary = step.tool === 'sip_test'
        ? `${step.params.method} ${step.params.uri}`
        : step.tool === 'generate_audio'
          ? `"${step.params.filename}"`
          : step.tool;

      onUpdate?.({ content: [{ type: 'text', text: `\n--- Step ${i + 1}/${manifest.steps.length}: ${step.tool} ${paramSummary} ---` }], details: {} });

      try {
        const result = await tool.execute(
          `replay-${i + 1}`,
          step.params,
          signal,
          onUpdate,
        );

        const resultText = (result.content as Array<{ type: string; text?: string }>)
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');

        const success = result.details && typeof result.details === 'object' && 'success' in result.details
          ? !!(result.details as Record<string, unknown>).success
          : !resultText.includes('❌');

        results.push(`Step ${i + 1} (${step.tool}): ${success ? 'PASS' : 'FAIL'} — ${resultText}`);
        if (success) passed++; else failed++;
      } catch (error) {
        const msg = `Step ${i + 1} (${step.tool}): ERROR — ${error instanceof Error ? error.message : String(error)}`;
        results.push(msg);
        onUpdate?.({ content: [{ type: 'text', text: msg }], details: {} });
        failed++;
      }
    }

    const summary = `Replay complete: ${passed} passed, ${failed} failed (from session ${basename(sourceDir)})`;

    return {
      content: [{ type: 'text', text: summary }],
      details: { sourceSession: basename(sourceDir), passed, failed, results },
    };
  },
};
