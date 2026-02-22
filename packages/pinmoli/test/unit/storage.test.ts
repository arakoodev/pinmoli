import { describe, it, expect, beforeEach } from 'vitest';
import type { TestConfig } from '../../src/validation/schemas.js';

// Note: These tests use the real database at ~/.pinmoli/
// Each test should use unique collection names to avoid conflicts

describe('Storage', () => {
  const mockConfig: TestConfig = {
    uri: 'sip:test@example.com',
    method: 'OPTIONS',
    codecs: ['opus'],
    transport: 'auto',
    mediaPort: 10000
  };

  // Generate unique names for each test
  let testCounter = 0;
  beforeEach(() => {
    testCounter++;
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
