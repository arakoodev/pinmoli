import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { TestConfig } from '../../src/validation/schemas.js';

describe('Storage', () => {
  const mockConfig: TestConfig = {
    uri: 'sip:test@example.com',
    method: 'OPTIONS',
    codecs: ['opus'],
    transport: 'auto',
    mediaPort: 10000
  };

  let tempDir = '';
  let testCounter = 0;
  beforeEach(async () => {
    testCounter++;
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'pinmoli-storage-'));
    process.env.PINMOLI_CONFIG_DIR = tempDir;
    process.env.PINMOLI_STORAGE_BACKEND = 'json';
    vi.resetModules();
    const storage = await import('../../src/storage/db.js');
    storage.resetStorageForTests();
  });

  afterEach(async () => {
    const storage = await import('../../src/storage/db.js');
    storage.resetStorageForTests();
    delete process.env.PINMOLI_CONFIG_DIR;
    delete process.env.PINMOLI_STORAGE_BACKEND;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not initialize storage until first operation', async () => {
    const storage = await import('../../src/storage/db.js');

    expect(storage.getStorageInfo()).toEqual({
      initialized: false,
      kind: 'json',
      path: path.join(tempDir, 'pinmoli.json'),
    });

    storage.saveCollection(`lazy-init-${Date.now()}-${testCounter}`, mockConfig);

    expect(storage.getStorageInfo()).toEqual({
      initialized: true,
      kind: 'json',
      path: path.join(tempDir, 'pinmoli.json'),
    });
  });

  it('saves and loads collection', async () => {
    const { saveCollection, loadCollection } = await import('../../src/storage/db.js');
    const name = `test-save-load-${Date.now()}-${testCounter}`;

    saveCollection(name, mockConfig);
    const loaded = loadCollection(name);

    expect(loaded).toEqual(mockConfig);
  });

  it('returns null for non-existent collection', async () => {
    const { loadCollection } = await import('../../src/storage/db.js');
    const loaded = loadCollection(`does-not-exist-${Date.now()}`);
    expect(loaded).toBeNull();
  });

  it('lists all collections', async () => {
    const { saveCollection, getAllCollections } = await import('../../src/storage/db.js');
    const name1 = `test-list-1-${Date.now()}-${testCounter}`;
    const name2 = `test-list-2-${Date.now()}-${testCounter}`;

    saveCollection(name1, mockConfig);
    saveCollection(name2, mockConfig);

    const collections = getAllCollections();
    const names = collections.map(c => c.name);
    expect(names).toContain(name1);
    expect(names).toContain(name2);
  });

  it('removes collection', async () => {
    const { saveCollection, removeCollection, loadCollection } = await import('../../src/storage/db.js');
    const name = `test-remove-${Date.now()}-${testCounter}`;

    saveCollection(name, mockConfig);
    removeCollection(name);

    const loaded = loadCollection(name);
    expect(loaded).toBeNull();
  });

  it('enforces unique collection names', async () => {
    const { saveCollection } = await import('../../src/storage/db.js');
    const name = `test-unique-${Date.now()}-${testCounter}`;

    saveCollection(name, mockConfig);

    // Should throw on duplicate name
    expect(() => saveCollection(name, mockConfig)).toThrow(/UNIQUE constraint/);
  });
});
