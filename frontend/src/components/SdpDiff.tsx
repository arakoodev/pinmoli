'use client';

import { AlertTriangle, CheckCircle } from 'lucide-react';

interface SdpDiffProps {
  offer: string | null;
  answer: string | null;
}

interface SdpIssue {
  severity: 'warning' | 'error' | 'info';
  message: string;
}

function parseSdpLines(sdp: string): Record<string, string[]> {
  const sections: Record<string, string[]> = { session: [] };
  let current = 'session';
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith('m=')) {
      current = line;
      sections[current] = [];
    }
    sections[current].push(line);
  }
  return sections;
}

function extractCodecs(sdp: string): string[] {
  const codecs: string[] = [];
  for (const line of sdp.split(/\r?\n/)) {
    const match = line.match(/^a=rtpmap:\d+\s+(.+)/);
    if (match) codecs.push(match[1]);
  }
  return codecs;
}

function extractConnectionIp(sdp: string): string | null {
  for (const line of sdp.split(/\r?\n/)) {
    const match = line.match(/^c=IN IP4 (.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

function analyzeSdp(sdp: string, label: string): SdpIssue[] {
  const issues: SdpIssue[] = [];
  const ip = extractConnectionIp(sdp);

  if (ip === '0.0.0.0') {
    issues.push({ severity: 'error', message: `${label}: Connection address is 0.0.0.0 — media will fail silently` });
  } else if (ip && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip)) {
    issues.push({ severity: 'warning', message: `${label}: Private IP ${ip} — media may be unreachable` });
  }

  if (sdp.includes('\\r\\n')) {
    issues.push({ severity: 'error', message: `${label}: Contains literal \\r\\n (escaped) instead of actual CRLF` });
  }

  return issues;
}

function SdpPanel({ label, sdp }: { label: string; sdp: string }) {
  const codecs = extractCodecs(sdp);
  const ip = extractConnectionIp(sdp);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{label}</h4>
        {ip && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">{ip}</span>
        )}
      </div>
      {codecs.length > 0 && (
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {codecs.map((c) => (
            <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-indigo-950/50 text-indigo-300 border border-indigo-900/30 font-mono">
              {c}
            </span>
          ))}
        </div>
      )}
      <pre className="text-xs font-mono text-zinc-400 bg-black/50 rounded p-3 overflow-x-auto leading-relaxed border border-zinc-800/50">
        {sdp.split(/\r?\n/).map((line, i) => {
          let color = 'text-zinc-400';
          if (line.startsWith('m=')) color = 'text-indigo-400';
          else if (line.startsWith('a=rtpmap')) color = 'text-emerald-400';
          else if (line.startsWith('c=')) color = 'text-yellow-400';
          else if (line.startsWith('o=')) color = 'text-blue-400';
          return (
            <div key={i} className={color}>
              {line || ' '}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export default function SdpDiff({ offer, answer }: SdpDiffProps) {
  if (!offer && !answer) {
    return (
      <div className="text-zinc-600 font-mono text-sm p-4">
        {'// SDP will appear after an INVITE transaction'}
      </div>
    );
  }

  const issues: SdpIssue[] = [];
  if (offer) issues.push(...analyzeSdp(offer, 'Offer'));
  if (answer) issues.push(...analyzeSdp(answer, 'Answer'));

  // Compare codecs
  if (offer && answer) {
    const offerCodecs = extractCodecs(offer);
    const answerCodecs = extractCodecs(answer);
    const negotiated = answerCodecs.filter((c) => offerCodecs.some((oc) => oc.split('/')[0] === c.split('/')[0]));
    if (negotiated.length > 0) {
      issues.push({ severity: 'info', message: `Negotiated: ${negotiated.join(', ')}` });
    }
  }

  return (
    <div className="space-y-3 p-4">
      {issues.length > 0 && (
        <div className="space-y-1.5">
          {issues.map((issue, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 text-xs rounded px-2.5 py-1.5 ${
                issue.severity === 'error'
                  ? 'bg-red-950/30 text-red-400 border border-red-900/30'
                  : issue.severity === 'warning'
                    ? 'bg-yellow-950/30 text-yellow-400 border border-yellow-900/30'
                    : 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/30'
              }`}
            >
              {issue.severity === 'info'
                ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              }
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        {offer && <SdpPanel label="Offer (sent)" sdp={offer} />}
        {answer && <SdpPanel label="Answer (received)" sdp={answer} />}
      </div>
    </div>
  );
}
