export interface RequestConfig {
  method: 'INVITE' | 'REGISTER' | 'OPTIONS';
  uri: string;
  transport: 'udp' | 'tcp' | 'auto';
  headers: Record<string, string>;
  codecs: string[];
  customSdp: string | null;
  auth: { username: string; password: string };
  audio: {
    source: 'silence' | 'tone' | 'tts' | 'file';
    ttsText?: string;
    frequency?: number;
    duration?: number;
    filePath?: string;
  };
}

export interface SavedRequest {
  id: string;
  name: string;
  config: RequestConfig;
  createdAt: number;
}

export interface Collection {
  id: string;
  name: string;
  items: SavedRequest[];
}

export interface HistoryEntry {
  id: string;
  config: RequestConfig;
  timestamp: number;
  result: 'success' | 'error' | 'timeout';
  statusCode?: number;
}

const COLLECTIONS_KEY = 'pfv-collections';
const HISTORY_KEY = 'pfv-history';
const MAX_HISTORY = 50;

export function defaultConfig(): RequestConfig {
  return {
    method: 'INVITE',
    uri: 'sip:agent@example.com',
    transport: 'auto',
    headers: {},
    codecs: ['opus', 'PCMU'],
    customSdp: null,
    auth: { username: '', password: '' },
    audio: { source: 'silence', duration: 5 },
  };
}

// ── Collections ──────────────────────────────────────────────────────

export function loadCollections(): Collection[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(COLLECTIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveCollections(collections: Collection[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
}

export function addToCollection(collectionId: string, item: SavedRequest) {
  const collections = loadCollections();
  const col = collections.find((c) => c.id === collectionId);
  if (col) {
    col.items.push(item);
    saveCollections(collections);
  }
}

export function createCollection(name: string): Collection {
  const collections = loadCollections();
  const newCol: Collection = { id: `col-${Date.now()}`, name, items: [] };
  collections.push(newCol);
  saveCollections(collections);
  return newCol;
}

export function deleteCollection(id: string) {
  const collections = loadCollections().filter((c) => c.id !== id);
  saveCollections(collections);
}

export function deleteFromCollection(collectionId: string, itemId: string) {
  const collections = loadCollections();
  const col = collections.find((c) => c.id === collectionId);
  if (col) {
    col.items = col.items.filter((i) => i.id !== itemId);
    saveCollections(collections);
  }
}

// ── History ──────────────────────────────────────────────────────────

export function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addToHistory(entry: HistoryEntry) {
  if (typeof window === 'undefined') return;
  const history = loadHistory();
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearHistory() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(HISTORY_KEY);
}

// ── Export / Import ──────────────────────────────────────────────────

export function exportCollections(): string {
  return JSON.stringify(loadCollections(), null, 2);
}

export function importCollections(json: string) {
  const imported: Collection[] = JSON.parse(json);
  const existing = loadCollections();
  saveCollections([...existing, ...imported]);
}
