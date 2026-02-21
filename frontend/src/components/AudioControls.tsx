'use client';

import { Volume2, Music, MessageSquare, VolumeX } from 'lucide-react';

interface AudioConfig {
  source: 'silence' | 'tone' | 'tts' | 'file';
  ttsText?: string;
  frequency?: number;
  duration?: number;
  filePath?: string;
}

interface AudioControlsProps {
  config: AudioConfig;
  onChange: (config: AudioConfig) => void;
}

const SOURCES = [
  { id: 'silence' as const, label: 'Silence', icon: VolumeX, description: 'Comfort noise — test VAD/barge-in' },
  { id: 'tone' as const, label: 'Tone', icon: Music, description: 'Sine wave — test media path' },
  { id: 'tts' as const, label: 'Text-to-Speech', icon: MessageSquare, description: 'espeak-ng synthesized voice' },
  { id: 'file' as const, label: 'Audio File', icon: Volume2, description: 'Upload .wav file' },
];

export default function AudioControls({ config, onChange }: AudioControlsProps) {
  return (
    <div className="p-4 space-y-4">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Audio Source</h4>

      <div className="grid grid-cols-2 gap-2">
        {SOURCES.map((source) => {
          const Icon = source.icon;
          const active = config.source === source.id;
          return (
            <button
              key={source.id}
              onClick={() => onChange({ ...config, source: source.id })}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                active
                  ? 'border-indigo-500/50 bg-indigo-950/30 text-indigo-300'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{source.label}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{source.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Duration (shared by silence and tone) */}
      {(config.source === 'silence' || config.source === 'tone') && (
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Duration (seconds)</label>
          <input
            type="number"
            value={config.duration || 5}
            min={1}
            max={60}
            onChange={(e) => onChange({ ...config, duration: parseInt(e.target.value) || 5 })}
            className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
      )}

      {/* Tone frequency */}
      {config.source === 'tone' && (
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Frequency (Hz)</label>
          <input
            type="number"
            value={config.frequency || 1000}
            min={100}
            max={8000}
            step={100}
            onChange={(e) => onChange({ ...config, frequency: parseInt(e.target.value) || 1000 })}
            className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
      )}

      {/* TTS text */}
      {config.source === 'tts' && (
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Text to speak</label>
          <textarea
            value={config.ttsText || ''}
            onChange={(e) => onChange({ ...config, ttsText: e.target.value })}
            placeholder="Hello, this is the Postman for Voice testing framework. Are you receiving me?"
            className="w-full h-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>
      )}

      {/* File upload */}
      {config.source === 'file' && (
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Audio file path (inside container)</label>
          <input
            type="text"
            value={config.filePath || ''}
            onChange={(e) => onChange({ ...config, filePath: e.target.value })}
            placeholder="/uploads/test.wav"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
          />
          <p className="text-[11px] text-zinc-600 mt-1">
            File must be accessible inside the Docker container. Mount via docker-compose volumes.
          </p>
        </div>
      )}
    </div>
  );
}
