import type { TestConfig } from '../validation/schemas.js';
import { saveCollection, loadCollection, getAllCollections } from '../storage/db.js';

export async function saveTestHandler(params: { name: string; config: TestConfig }): Promise<string> {
  saveCollection(params.name, params.config);
  return `✓ Saved test "${params.name}" to collections`;
}

export async function loadTestHandler(params: { name: string }): Promise<TestConfig> {
  const config = loadCollection(params.name);
  if (!config) {
    throw new Error(`Test "${params.name}" not found in collections`);
  }
  return config;
}

export async function listTestsHandler(): Promise<string[]> {
  const collections = getAllCollections();
  if (collections.length === 0) {
    return ['No saved tests found'];
  }
  return collections.map(c => `${c.name} (saved ${new Date(c.createdAt).toLocaleString()})`);
}

