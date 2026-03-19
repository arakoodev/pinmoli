/**
 * Session directory management for test runs.
 *
 * Each test run (SIP or WebRTC) gets its own directory under captures/
 * grouping all artifacts: SIP/signaling log, audio files, metadata.
 */

import { mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

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

/**
 * Create a session directory under captures/.
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
  const dir = resolve(process.cwd(), 'captures', name);

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
