import path from 'path';
import os from 'os';
import fs from 'fs';
import { createRequire } from 'module';
import type { TestConfig, SavedRequest } from '../validation/schemas.js';

const require = createRequire(import.meta.url);

type StorageBackendKind = 'sqlite' | 'json';

interface StorageBackend {
  kind: StorageBackendKind;
  path: string;
  saveCollection(name: string, config: TestConfig): void;
  loadCollection(name: string): TestConfig | null;
  getAllCollections(): Array<{ name: string; createdAt: number }>;
  removeCollection(name: string): void;
  addToHistory(config: TestConfig, result?: 'success' | 'error', statusCode?: number): void;
  getRecentHistory(): SavedRequest[];
}

interface JsonCollection {
  id: string;
  name: string;
  config: TestConfig;
  createdAt: number;
}

interface JsonHistoryEntry {
  id: string;
  config: TestConfig;
  result?: 'success' | 'error';
  statusCode?: number;
  timestamp: number;
}

interface JsonStorageState {
  collections: JsonCollection[];
  history: JsonHistoryEntry[];
}

type BetterSqliteStatement = {
  run(...args: unknown[]): unknown;
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
};

type BetterSqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): BetterSqliteStatement;
};

type BetterSqliteCtor = new (filename: string) => BetterSqliteDatabase;

const EMPTY_STORAGE_STATE: JsonStorageState = {
  collections: [],
  history: [],
};

let backend: StorageBackend | null = null;

function getConfigDir(): string {
  return process.env.PINMOLI_CONFIG_DIR
    ? path.resolve(process.env.PINMOLI_CONFIG_DIR)
    : path.join(os.homedir(), '.pinmoli');
}

function ensureConfigDir(): void {
  fs.mkdirSync(getConfigDir(), { recursive: true });
}

function getPreferredBackend(): 'auto' | StorageBackendKind {
  const requested = process.env.PINMOLI_STORAGE_BACKEND;
  if (requested === 'sqlite' || requested === 'json') {
    return requested;
  }
  return 'auto';
}

function getSqlitePath(): string {
  return process.env.PINMOLI_DB_PATH
    ? path.resolve(process.env.PINMOLI_DB_PATH)
    : path.join(getConfigDir(), 'pinmoli.db');
}

function getJsonPath(): string {
  return process.env.PINMOLI_STORAGE_JSON_PATH
    ? path.resolve(process.env.PINMOLI_STORAGE_JSON_PATH)
    : path.join(getConfigDir(), 'pinmoli.json');
}

function initBackend(): StorageBackend {
  ensureConfigDir();

  const preferred = getPreferredBackend();
  if (preferred === 'json') {
    return createJsonBackend(getJsonPath());
  }

  try {
    return createSqliteBackend(getSqlitePath());
  } catch (error) {
    if (preferred === 'sqlite') {
      throw error;
    }
    return createJsonBackend(getJsonPath());
  }
}

function getBackend(): StorageBackend {
  if (!backend) {
    backend = initBackend();
  }
  return backend;
}

function createSqliteBackend(dbPath: string): StorageBackend {
  const BetterSqlite = require('better-sqlite3') as BetterSqliteCtor;
  const db = new BetterSqlite(dbPath);

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

    CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);
    CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_history_result ON history(result);
    CREATE INDEX IF NOT EXISTS idx_history_status ON history(status_code);
    CREATE INDEX IF NOT EXISTS idx_collections_uri ON collections(json_extract(config, '$.uri'));

    CREATE VIRTUAL TABLE IF NOT EXISTS collections_fts USING fts5(name, config, content=collections, content_rowid=rowid);

    CREATE TRIGGER IF NOT EXISTS collections_ai AFTER INSERT ON collections BEGIN
      INSERT INTO collections_fts(rowid, name, config) VALUES (new.rowid, new.name, new.config);
    END;

    CREATE TRIGGER IF NOT EXISTS collections_ad AFTER DELETE ON collections BEGIN
      DELETE FROM collections_fts WHERE rowid = old.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS collections_au AFTER UPDATE ON collections BEGIN
      UPDATE collections_fts SET name = new.name, config = new.config WHERE rowid = new.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS cleanup_old_history
    AFTER INSERT ON history
    BEGIN
      DELETE FROM history WHERE id NOT IN (
        SELECT id FROM history ORDER BY timestamp DESC LIMIT 100
      );
    END;
  `);

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

  return {
    kind: 'sqlite',
    path: dbPath,
    saveCollection(name, config) {
      insertCollection.run(`col-${Date.now()}`, name, JSON.stringify(config), Date.now());
    },
    loadCollection(name) {
      const row = getCollection.get(name) as { config: string } | undefined;
      if (!row) return null;
      return JSON.parse(row.config) as TestConfig;
    },
    getAllCollections() {
      const rows = listCollections.all() as Array<{ name: string; created_at: number }>;
      return rows.map((row) => ({ name: row.name, createdAt: row.created_at }));
    },
    removeCollection(name) {
      deleteCollection.run(name);
    },
    addToHistory(config, result, statusCode) {
      insertHistory.run(
        `hist-${Date.now()}`,
        JSON.stringify(config),
        result ?? null,
        statusCode ?? null,
        Date.now(),
      );
    },
    getRecentHistory() {
      const rows = getHistory.all() as Array<{
        id: string;
        config: string;
        timestamp: number;
        result?: 'success' | 'error';
        status_code?: number;
      }>;
      return rows.map((row) => ({
        id: row.id,
        name: 'History entry',
        config: JSON.parse(row.config) as TestConfig,
        timestamp: row.timestamp,
        result: row.result,
        statusCode: row.status_code,
      }));
    },
  };
}

function loadJsonState(filePath: string): JsonStorageState {
  if (!fs.existsSync(filePath)) {
    return structuredClone(EMPTY_STORAGE_STATE);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<JsonStorageState>;
    return {
      collections: Array.isArray(parsed.collections) ? parsed.collections : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return structuredClone(EMPTY_STORAGE_STATE);
  }
}

function flushJsonState(filePath: string, state: JsonStorageState): void {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

function createJsonBackend(filePath: string): StorageBackend {
  const state = loadJsonState(filePath);

  return {
    kind: 'json',
    path: filePath,
    saveCollection(name, config) {
      if (state.collections.some((collection) => collection.name === name)) {
        throw new Error('UNIQUE constraint failed: collections.name');
      }

      state.collections.push({
        id: `col-${Date.now()}`,
        name,
        config,
        createdAt: Date.now(),
      });
      state.collections.sort((a, b) => b.createdAt - a.createdAt);
      flushJsonState(filePath, state);
    },
    loadCollection(name) {
      const collection = state.collections.find((item) => item.name === name);
      return collection ? structuredClone(collection.config) : null;
    },
    getAllCollections() {
      return state.collections
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((collection) => ({
          name: collection.name,
          createdAt: collection.createdAt,
        }));
    },
    removeCollection(name) {
      const index = state.collections.findIndex((item) => item.name === name);
      if (index >= 0) {
        state.collections.splice(index, 1);
        flushJsonState(filePath, state);
      }
    },
    addToHistory(config, result, statusCode) {
      state.history.unshift({
        id: `hist-${Date.now()}`,
        config,
        result,
        statusCode,
        timestamp: Date.now(),
      });
      state.history = state.history.slice(0, 100);
      flushJsonState(filePath, state);
    },
    getRecentHistory() {
      return state.history
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((entry) => ({
          id: entry.id,
          name: 'History entry',
          config: structuredClone(entry.config),
          timestamp: entry.timestamp,
          result: entry.result,
          statusCode: entry.statusCode,
        }));
    },
  };
}

export function getStorageInfo(): { initialized: boolean; kind: StorageBackendKind | null; path: string } {
  if (backend) {
    return {
      initialized: true,
      kind: backend.kind,
      path: backend.path,
    };
  }

  const preferred = getPreferredBackend();
  return {
    initialized: false,
    kind: preferred === 'auto' ? null : preferred,
    path: preferred === 'json' ? getJsonPath() : getSqlitePath(),
  };
}

export function resetStorageForTests(): void {
  backend = null;
}

export function saveCollection(name: string, config: TestConfig): void {
  getBackend().saveCollection(name, config);
}

export function loadCollection(name: string): TestConfig | null {
  return getBackend().loadCollection(name);
}

export function getAllCollections(): Array<{ name: string; createdAt: number }> {
  return getBackend().getAllCollections();
}

export function removeCollection(name: string): void {
  getBackend().removeCollection(name);
}

export function addToHistory(config: TestConfig, result?: 'success' | 'error', statusCode?: number): void {
  getBackend().addToHistory(config, result, statusCode);
}

export function getRecentHistory(): SavedRequest[] {
  return getBackend().getRecentHistory();
}
