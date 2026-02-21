'use client';

import {
  PhoneCall,
  Settings,
  History,
  FolderOpen,
  Play,
  Plus,
  Trash2,
  Download,
  Upload,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { RequestConfig } from '@/lib/collections';
import {
  loadCollections,
  saveCollections,
  createCollection,
  deleteCollection,
  deleteFromCollection,
  loadHistory,
  clearHistory,
  exportCollections,
  importCollections,
  type Collection,
  type HistoryEntry,
} from '@/lib/collections';

interface SidebarProps {
  onLoadConfig: (config: RequestConfig) => void;
  onSaveConfig: (collectionId: string) => void;
  currentConfig: RequestConfig;
}

function methodColor(method: string) {
  switch (method) {
    case 'INVITE': return 'text-green-400';
    case 'REGISTER': return 'text-yellow-400';
    case 'OPTIONS': return 'text-blue-400';
    default: return 'text-zinc-400';
  }
}

function truncateUri(uri: string, max = 24) {
  if (uri.length <= max) return uri;
  return uri.slice(0, max) + '...';
}

export default function Sidebar({ onLoadConfig, onSaveConfig, currentConfig }: SidebarProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expandedCol, setExpandedCol] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [newColName, setNewColName] = useState('');
  const [showNewCol, setShowNewCol] = useState(false);

  useEffect(() => {
    setCollections(loadCollections());
    setHistory(loadHistory());
  }, []);

  const refresh = () => {
    setCollections(loadCollections());
    setHistory(loadHistory());
  };

  const handleCreateCollection = () => {
    if (!newColName.trim()) return;
    createCollection(newColName.trim());
    setNewColName('');
    setShowNewCol(false);
    refresh();
  };

  const handleDeleteCollection = (id: string) => {
    deleteCollection(id);
    refresh();
  };

  const handleExport = () => {
    const json = exportCollections();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pfv-collections.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importCollections(reader.result as string);
          refresh();
        } catch {}
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleClearHistory = () => {
    clearHistory();
    refresh();
  };

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-900/50 flex flex-col">
      <div className="p-4 border-b border-zinc-800 flex items-center space-x-2">
        <PhoneCall className="w-5 h-5 text-indigo-500" />
        <span className="font-semibold text-zinc-100">Voice Workspace</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Collections */}
        <div className="p-2">
          <div className="flex items-center justify-between px-2 mb-2 mt-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Collections</span>
            <div className="flex items-center gap-1">
              <button onClick={handleImport} title="Import" className="text-zinc-600 hover:text-zinc-300 p-0.5">
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleExport} title="Export" className="text-zinc-600 hover:text-zinc-300 p-0.5">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setShowNewCol(true)} title="New collection" className="text-zinc-600 hover:text-zinc-300 p-0.5">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {showNewCol && (
            <div className="flex gap-1 px-2 mb-2">
              <input
                type="text"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
                placeholder="Collection name"
                autoFocus
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
              />
              <button onClick={handleCreateCollection} className="text-xs text-indigo-400 hover:text-indigo-300 px-1.5">
                Add
              </button>
            </div>
          )}

          {collections.length === 0 && !showNewCol && (
            <p className="text-[11px] text-zinc-600 px-2 mb-2">No collections. Click + to create one.</p>
          )}

          {collections.map((col) => (
            <div key={col.id} className="mb-1">
              <button
                onClick={() => setExpandedCol(expandedCol === col.id ? null : col.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-left group"
              >
                {expandedCol === col.id ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                )}
                <FolderOpen className="w-4 h-4 text-indigo-400" />
                <span className="flex-1 text-zinc-300 truncate">{col.name}</span>
                <span className="text-[10px] text-zinc-600">{col.items.length}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteCollection(col.id); }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 p-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </button>

              {expandedCol === col.id && (
                <div className="ml-6 space-y-0.5">
                  {col.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onLoadConfig(item.config)}
                      className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 text-left"
                    >
                      <span className={`text-[10px] font-mono font-bold ${methodColor(item.config.method)}`}>
                        {item.config.method.slice(0, 3)}
                      </span>
                      <span className="text-xs text-zinc-400 truncate">{item.name}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => onSaveConfig(col.id)}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 text-xs text-indigo-400"
                  >
                    <Plus className="w-3 h-3" />
                    Save current
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* History */}
        <div className="p-2 border-t border-zinc-800/50">
          <div className="flex items-center justify-between px-2 mb-2 mt-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider"
            >
              {showHistory ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              History
            </button>
            {history.length > 0 && (
              <button onClick={handleClearHistory} className="text-[10px] text-zinc-600 hover:text-zinc-400">
                Clear
              </button>
            )}
          </div>

          {showHistory && (
            <div className="space-y-0.5">
              {history.length === 0 && (
                <p className="text-[11px] text-zinc-600 px-2">No history yet.</p>
              )}
              {history.slice(0, 20).map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onLoadConfig(entry.config)}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 text-left"
                >
                  <span className={`text-[10px] font-mono font-bold ${methodColor(entry.config.method)}`}>
                    {entry.config.method.slice(0, 3)}
                  </span>
                  <span className="text-xs text-zinc-400 truncate flex-1">{truncateUri(entry.config.uri)}</span>
                  <span className={`text-[10px] ${entry.result === 'success' ? 'text-green-500' : entry.result === 'error' ? 'text-red-500' : 'text-yellow-500'}`}>
                    {entry.statusCode || entry.result}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-zinc-800">
        <button className="flex items-center space-x-2 text-sm text-zinc-400 hover:text-zinc-100">
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
