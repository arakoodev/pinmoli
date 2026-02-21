'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface HeaderEditorProps {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}

const COMMON_HEADERS = [
  'Allow',
  'User-Agent',
  'X-Custom',
  'X-Livekit-Room',
  'X-Daily-Room',
  'Authorization',
  'Proxy-Authorization',
];

export default function HeaderEditor({ headers, onChange }: HeaderEditorProps) {
  const entries = Object.entries(headers);

  const addHeader = () => {
    onChange({ ...headers, '': '' });
  };

  const updateKey = (oldKey: string, newKey: string, index: number) => {
    const newHeaders: Record<string, string> = {};
    let i = 0;
    for (const [k, v] of Object.entries(headers)) {
      if (i === index) {
        newHeaders[newKey] = v;
      } else {
        newHeaders[k] = v;
      }
      i++;
    }
    onChange(newHeaders);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...headers, [key]: value });
  };

  const removeHeader = (key: string) => {
    const { [key]: _, ...rest } = headers;
    onChange(rest);
  };

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Custom Headers</h4>
        <button
          onClick={addHeader}
          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Header
        </button>
      </div>

      {entries.length === 0 && (
        <p className="text-xs text-zinc-600 font-mono">No custom headers. Click &ldquo;Add Header&rdquo; to add one.</p>
      )}

      {entries.map(([key, value], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={key}
            onChange={(e) => updateKey(key, e.target.value, i)}
            placeholder="Header-Name"
            list="common-headers"
            className="w-40 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
          />
          <span className="text-zinc-600 text-xs">:</span>
          <input
            type="text"
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            placeholder="value"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => removeHeader(key)}
            className="text-zinc-600 hover:text-red-400 transition-colors p-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <datalist id="common-headers">
        {COMMON_HEADERS.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
    </div>
  );
}
