/**
 * Session directory management for test runs.
 *
 * All output is scoped under a CLI-level session directory so parallel
 * Pinmoli instances don't collide:
 *
 *   captures/{cli-session-id}/
 *     audio-samples/          — generated TTS audio
 *     sip-options-host-ts/    — per-test artifacts
 *     sip-invite-host-ts/     — per-test artifacts (logs, metadata, WAVs)
 *     webrtc-whip-host-ts/    — per-test artifacts
 */

import { mkdirSync, appendFileSync, writeFileSync, accessSync, constants, existsSync } from 'fs';
import os from 'os';
import { resolve, basename, dirname } from 'path';

export interface Session {
  /** Absolute path to session directory */
  dir: string;
  /** Session name (used as directory name) */
  name: string;
  /** Append a line to the signaling log (sip-log.txt or signaling-log.txt) */
  logSignaling(direction: '>>>' | '<<<', label: string, raw: string): void;
  /** Write metadata.json at end of session */
  writeMetadata(meta: Record<string, unknown>): void;
  /** Resolve a filename within the session directory */
  file(name: string): string;
}

function canCreateOrWrite(dir: string): boolean {
  const target = existsSync(dir) ? dir : dirname(dir);
  try {
    accessSync(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the base directory that stores captures/ session output.
 *
 * Priority:
 * 1. PINMOLI_CAPTURES_DIR override
 * 2. ./captures when the current checkout is writable
 * 3. ~/.pinmoli/captures as a safe fallback for read-only checkouts/tests
 */
export function getCapturesBaseDir(): string {
  if (process.env.PINMOLI_CAPTURES_DIR) {
    return resolve(process.env.PINMOLI_CAPTURES_DIR);
  }

  // eslint-disable-next-line pinmoli/no-cwd-captures-default -- this IS the canonical helper
  const repoCapturesDir = resolve(process.cwd(), 'captures');
  if (canCreateOrWrite(repoCapturesDir)) {
    return repoCapturesDir;
  }

  return resolve(os.homedir(), '.pinmoli', 'captures');
}

/**
 * Initialize a CLI-level session root. Called once at startup.
 * All per-test directories and audio-samples nest under this.
 * Returns the absolute path to the session root directory.
 */
export function initCliSession(): string {
  const ts = new Date();
  const stamp = [
    ts.getFullYear(),
    String(ts.getMonth() + 1).padStart(2, '0'),
    String(ts.getDate()).padStart(2, '0'),
    '-',
    String(ts.getHours()).padStart(2, '0'),
    String(ts.getMinutes()).padStart(2, '0'),
    String(ts.getSeconds()).padStart(2, '0'),
  ].join('');
  const rand = Math.random().toString(36).slice(2, 6);
  const sessionId = `${stamp}-${rand}`;
  const sessionRoot = resolve(getCapturesBaseDir(), sessionId);
  mkdirSync(sessionRoot, { recursive: true });
  process.env.PINMOLI_SESSION_DIR = sessionRoot;
  return sessionRoot;
}

/**
 * Get the CLI session root directory.
 * Falls back to captures/ if no CLI session was initialized (e.g. tests).
 */
export function getSessionRoot(): string {
  return process.env.PINMOLI_SESSION_DIR || getCapturesBaseDir();
}

// ---- Session manifest (tool call recording for replay) ----

export interface ToolCallRecord {
  seq: number;
  tool: string;
  params: Record<string, unknown>;
  timestamp: string;
  durationMs: number;
  success: boolean;
  /** Per-test session directory name (e.g. "sip-invite-host-20260320-065114") */
  testDir?: string;
}

export interface SessionManifest {
  version: number;
  sessionId: string;
  startTime: string;
  provider?: string;
  model?: string;
  steps: ToolCallRecord[];
}

let manifestData: SessionManifest | null = null;

/**
 * Initialize the session manifest. Called once after initCliSession().
 * Records which LLM provider/model drove this session.
 */
export function initManifest(provider?: string, model?: string): void {
  const root = getSessionRoot();
  manifestData = {
    version: 1,
    sessionId: basename(root),
    startTime: new Date().toISOString(),
    provider,
    model,
    steps: [],
  };
  flushManifest();
}

/**
 * Record a tool call in the session manifest.
 * No-ops if no session is active (e.g. during tests).
 */
export function recordToolCall(record: Omit<ToolCallRecord, 'seq'>): void {
  if (!manifestData) return;

  // Sanitize: redact auth passwords
  const params = { ...record.params };
  if (params.auth && typeof params.auth === 'object') {
    params.auth = { ...(params.auth as Record<string, unknown>), password: '***' };
  }

  manifestData.steps.push({
    ...record,
    params,
    seq: manifestData.steps.length + 1,
  });
  flushManifest();
}

function flushManifest(): void {
  if (!manifestData) return;
  try {
    const manifestPath = resolve(getSessionRoot(), 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2) + '\n');
  } catch { /* don't break tool execution if manifest write fails */ }
}

/**
 * Create a per-test session directory under the CLI session root.
 *
 * @param protocol - 'sip' or 'webrtc'
 * @param method   - SIP method (INVITE, OPTIONS) or 'whip'
 * @param host     - target host (extracted from URI)
 */
export function createSession(protocol: 'sip' | 'webrtc', method: string, host: string): Session {
  const ts = new Date();
  const stamp = [
    ts.getFullYear(),
    String(ts.getMonth() + 1).padStart(2, '0'),
    String(ts.getDate()).padStart(2, '0'),
    '-',
    String(ts.getHours()).padStart(2, '0'),
    String(ts.getMinutes()).padStart(2, '0'),
    String(ts.getSeconds()).padStart(2, '0'),
  ].join('');

  // Sanitize host for filesystem (strip port, replace dots)
  const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/:\d+$/, '');
  const name = `${protocol}-${method.toLowerCase()}-${safeHost}-${stamp}`;
  const root = getSessionRoot();
  const dir = resolve(root, name);

  mkdirSync(dir, { recursive: true });

  const logFile = resolve(dir, protocol === 'sip' ? 'sip-log.txt' : 'signaling-log.txt');

  return {
    dir,
    name,
    logSignaling(direction: '>>>' | '<<<', label: string, raw: string) {
      const now = new Date().toISOString();
      const entry = `[${now}] ${direction} ${label}\n${raw.trimEnd()}\n\n`;
      appendFileSync(logFile, entry);
    },
    writeMetadata(meta: Record<string, unknown>) {
      writeFileSync(resolve(dir, 'metadata.json'), JSON.stringify(meta, null, 2) + '\n');
    },
    file(filename: string) {
      return resolve(dir, filename);
    },
  };
}
