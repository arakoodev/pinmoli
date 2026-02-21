'use client';

import { ChevronDown, Zap } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { presets, resolvePresetUri, resolvePresetHeaders, type SipPreset } from '@/lib/presets';

interface PresetSelectorProps {
  onSelect: (preset: SipPreset, uri: string, headers: Record<string, string>) => void;
}

export default function PresetSelector({ onSelect }: PresetSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (preset: SipPreset) => {
    const uri = resolvePresetUri(preset, preset.placeholders);
    const headers = resolvePresetHeaders(preset, preset.placeholders);
    onSelect(preset, uri, headers);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2.5 py-1.5 transition-colors"
      >
        <Zap className="w-3.5 h-3.5" />
        Presets
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-zinc-800">
            <p className="text-[11px] text-zinc-500 px-2">Platform presets — auto-populate URI, headers, and codecs</p>
          </div>
          <div className="py-1">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleSelect(preset)}
                className="w-full flex flex-col items-start px-3 py-2 hover:bg-zinc-800/70 text-left transition-colors"
              >
                <span className="text-sm text-zinc-200 font-medium">{preset.name}</span>
                <span className="text-[11px] text-zinc-500 mt-0.5">{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
