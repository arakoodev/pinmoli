import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { createSession, getCapturesBaseDir, getSessionRoot, initCliSession } from '../../src/network/session.js';

describe('Session Root Resolution', () => {
  const originalCwd = process.cwd();
  const originalCapturesDir = process.env.PINMOLI_CAPTURES_DIR;
  const originalSessionDir = process.env.PINMOLI_SESSION_DIR;
  const tempDirs: string[] = [];

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalCapturesDir === undefined) {
      delete process.env.PINMOLI_CAPTURES_DIR;
    } else {
      process.env.PINMOLI_CAPTURES_DIR = originalCapturesDir;
    }

    if (originalSessionDir === undefined) {
      delete process.env.PINMOLI_SESSION_DIR;
    } else {
      process.env.PINMOLI_SESSION_DIR = originalSessionDir;
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses PINMOLI_CAPTURES_DIR for CLI and per-test sessions', () => {
    const capturesDir = mkdtempSync(path.join(os.tmpdir(), 'pinmoli-captures-'));
    tempDirs.push(capturesDir);

    process.env.PINMOLI_CAPTURES_DIR = capturesDir;
    delete process.env.PINMOLI_SESSION_DIR;

    expect(getCapturesBaseDir()).toBe(capturesDir);

    const cliSession = initCliSession();
    expect(cliSession.startsWith(capturesDir)).toBe(true);
    expect(getSessionRoot()).toBe(cliSession);

    const session = createSession('sip', 'OPTIONS', 'example.com');
    expect(session.dir.startsWith(cliSession)).toBe(true);
  });

  it('falls back outside the repo when cwd is not writable', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pinmoli-readonly-'));
    const readonlyDir = path.join(root, 'readonly');
    mkdirSync(readonlyDir);
    tempDirs.push(root);

    process.chdir(readonlyDir);
    delete process.env.PINMOLI_CAPTURES_DIR;
    delete process.env.PINMOLI_SESSION_DIR;

    chmodSync(readonlyDir, 0o555);
    try {
      expect(getCapturesBaseDir()).toBe(path.join(os.homedir(), '.pinmoli', 'captures'));
    } finally {
      chmodSync(readonlyDir, 0o755);
    }
  });
});
