import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { TestConfig, SavedRequest } from '../validation/schemas.js';

const CONFIG_DIR = path.join(os.homedir(), '.pinmoli');
const DB_PATH = path.join(CONFIG_DIR, 'pinmoli.db');

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    result TEXT,
    status_code INTEGER,
    timestamp INTEGER NOT NULL
  );
  
  -- Performance indexes
  CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);
  CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
  CREATE INDEX IF NOT EXISTS idx_history_result ON history(result);
  CREATE INDEX IF NOT EXISTS idx_history_status ON history(status_code);
  CREATE INDEX IF NOT EXISTS idx_collections_uri ON collections(json_extract(config, '$.uri'));
  
  -- Full-text search for collections
  CREATE VIRTUAL TABLE IF NOT EXISTS collections_fts USING fts5(name, config, content=collections, content_rowid=rowid);
  
  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS collections_ai AFTER INSERT ON collections BEGIN
    INSERT INTO collections_fts(rowid, name, config) VALUES (new.rowid, new.name, new.config);
  END;
  
  CREATE TRIGGER IF NOT EXISTS collections_ad AFTER DELETE ON collections BEGIN
    DELETE FROM collections_fts WHERE rowid = old.rowid;
  END;
  
  CREATE TRIGGER IF NOT EXISTS collections_au AFTER UPDATE ON collections BEGIN
    UPDATE collections_fts SET name = new.name, config = new.config WHERE rowid = new.rowid;
  END;
  
  -- Auto-cleanup old history (keep last 100)
  CREATE TRIGGER IF NOT EXISTS cleanup_old_history
  AFTER INSERT ON history
  BEGIN
    DELETE FROM history WHERE id NOT IN (
      SELECT id FROM history ORDER BY timestamp DESC LIMIT 100
    );
  END;
`);

// Prepared statements
const insertCollection = db.prepare(`
  INSERT INTO collections (id, name, config, created_at)
  VALUES (?, ?, ?, ?)
`);

const getCollection = db.prepare(`
  SELECT * FROM collections WHERE name = ?
`);

const listCollections = db.prepare(`
  SELECT id, name, created_at FROM collections ORDER BY created_at DESC
`);

const deleteCollection = db.prepare(`
  DELETE FROM collections WHERE name = ?
`);

const insertHistory = db.prepare(`
  INSERT INTO history (id, config, result, status_code, timestamp)
  VALUES (?, ?, ?, ?, ?)
`);

const getHistory = db.prepare(`
  SELECT * FROM history ORDER BY timestamp DESC LIMIT 100
`);

export function saveCollection(name: string, config: TestConfig): void {
  const id = `col-${Date.now()}`;
  insertCollection.run(id, name, JSON.stringify(config), Date.now());
}

export function loadCollection(name: string): TestConfig | null {
  const row = getCollection.get(name) as { config: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.config);
}

export function getAllCollections(): Array<{ name: string; createdAt: number }> {
  const rows = listCollections.all() as Array<{ name: string; created_at: number }>;
  return rows.map(r => ({ name: r.name, createdAt: r.created_at }));
}

export function removeCollection(name: string): void {
  deleteCollection.run(name);
}

export function addToHistory(config: TestConfig, result?: 'success' | 'error', statusCode?: number): void {
  const id = `hist-${Date.now()}`;
  insertHistory.run(id, JSON.stringify(config), result || null, statusCode || null, Date.now());
}

export function getRecentHistory(): SavedRequest[] {
  const rows = getHistory.all() as Array<{ id: string; config: string; timestamp: number; result?: 'success' | 'error'; status_code?: number }>;
  return rows.map(r => ({
    id: r.id,
    name: 'History entry',
    config: JSON.parse(r.config),
    timestamp: r.timestamp,
    result: r.result,
    statusCode: r.status_code
  }));
}
