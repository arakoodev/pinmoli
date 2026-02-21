'use client';

interface CodecPickerProps {
  selected: string[];
  onChange: (codecs: string[]) => void;
  customSdp: string | null;
  onCustomSdpChange: (sdp: string | null) => void;
}

const CODECS = [
  { id: 'opus', label: 'Opus', detail: 'opus/48000/2 (PT 111)', recommended: true },
  { id: 'PCMU', label: 'G.711 \u00B5-law', detail: 'PCMU/8000 (PT 0)', recommended: true },
  { id: 'PCMA', label: 'G.711 A-law', detail: 'PCMA/8000 (PT 8)', recommended: false },
  { id: 'G722', label: 'G.722', detail: 'G722/8000 (PT 9)', recommended: false },
];

export default function CodecPicker({ selected, onChange, customSdp, onCustomSdpChange }: CodecPickerProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length > 1) {
        onChange(selected.filter((c) => c !== id));
      }
    } else {
      onChange([...selected, id]);
    }
  };

  const useCustom = customSdp !== null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Codec Selection</h4>
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={useCustom}
            onChange={() => onCustomSdpChange(useCustom ? null : '')}
            className="rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
          />
          Raw SDP
        </label>
      </div>

      {!useCustom && (
        <div className="grid grid-cols-2 gap-2">
          {CODECS.map((codec) => (
            <button
              key={codec.id}
              onClick={() => toggle(codec.id)}
              className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors ${
                selected.includes(codec.id)
                  ? 'border-indigo-500/50 bg-indigo-950/30 text-indigo-300'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded border flex items-center justify-center ${
                    selected.includes(codec.id) ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-600'
                  }`}
                >
                  {selected.includes(codec.id) && (
                    <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="2" fill="none" />
                    </svg>
                  )}
                </div>
                <span className="text-sm font-medium">{codec.label}</span>
                {codec.recommended && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-indigo-950/50 text-indigo-400 border border-indigo-900/30">
                    recommended
                  </span>
                )}
              </div>
              <span className="text-[11px] text-zinc-500 mt-1 ml-5 font-mono">{codec.detail}</span>
            </button>
          ))}
        </div>
      )}

      {useCustom && (
        <div>
          <p className="text-xs text-zinc-500 mb-2">Paste a complete SDP body. Must use actual CRLF line endings.</p>
          <textarea
            value={customSdp || ''}
            onChange={(e) => onCustomSdpChange(e.target.value)}
            placeholder={`v=0\no=- 0 0 IN IP4 0.0.0.0\ns=-\nc=IN IP4 0.0.0.0\nt=0 0\nm=audio 10000 RTP/AVP 111 0\na=rtpmap:111 opus/48000/2\na=rtpmap:0 PCMU/8000\na=sendrecv`}
            className="w-full h-48 bg-black border border-zinc-800 rounded p-3 text-xs font-mono text-zinc-300 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>
      )}
    </div>
  );
}
