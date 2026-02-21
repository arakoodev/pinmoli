'use client';

import { ArrowUp, ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export interface SipEvent {
  type: string;
  event?: string;
  direction?: 'in' | 'out';
  method?: string;
  status?: number;
  reason?: string;
  uri?: string;
  headers?: Record<string, unknown>;
  sdpOffer?: string;
  sdpAnswer?: string;
  message?: string;
  severity?: string;
  timestamp?: number;
  elapsed?: number;
}

function formatElapsed(ms: number | undefined): string {
  if (ms === undefined || ms === null) return '';
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(2)}s`;
}

function formatTime(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'text-green-400';
  if (status >= 100 && status < 200) return 'text-blue-400';
  if (status >= 300 && status < 400) return 'text-yellow-400';
  return 'text-red-400';
}

function SipMessageRow({ event }: { event: SipEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isOut = event.direction === 'out';
  const Arrow = isOut ? ArrowUp : ArrowDown;
  const arrowColor = isOut ? 'text-indigo-400' : 'text-emerald-400';

  // Build the summary line
  let summary = '';
  if (event.method && !event.status) {
    summary = `${event.method}${event.uri ? ' ' + event.uri : ''}`;
  } else if (event.status) {
    summary = `${event.status} ${event.reason || ''}`;
  }

  const hasDetails = event.headers || event.sdpOffer || event.sdpAnswer;

  return (
    <div className="group">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-zinc-800/50 text-left font-mono text-sm transition-colors"
      >
        <Arrow className={`w-3.5 h-3.5 flex-shrink-0 ${arrowColor}`} />
        <span className={`flex-1 ${event.status ? statusColor(event.status) : 'text-zinc-200'}`}>
          {summary}
        </span>
        <span className="text-zinc-600 text-xs tabular-nums">{formatTime(event.timestamp)}</span>
        <span className="text-zinc-500 text-xs tabular-nums w-16 text-right">{formatElapsed(event.elapsed)}</span>
        {hasDetails && (
          expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" />
            : <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
        )}
      </button>

      {expanded && (
        <div className="ml-6 pl-4 border-l border-zinc-800 mb-2">
          {event.headers && (
            <div className="text-xs text-zinc-400 font-mono space-y-0.5 py-1">
              {Object.entries(event.headers).map(([key, val]) => (
                <div key={key}>
                  <span className="text-zinc-500">{key}:</span>{' '}
                  <span>{typeof val === 'string' ? val : JSON.stringify(val)}</span>
                </div>
              ))}
            </div>
          )}
          {event.sdpOffer && (
            <div className="mt-2">
              <div className="text-xs text-zinc-500 font-semibold mb-1">SDP Offer</div>
              <pre className="text-xs text-zinc-400 bg-zinc-900/50 p-2 rounded overflow-x-auto">{event.sdpOffer}</pre>
            </div>
          )}
          {event.sdpAnswer && (
            <div className="mt-2">
              <div className="text-xs text-zinc-500 font-semibold mb-1">SDP Answer</div>
              <pre className="text-xs text-zinc-400 bg-zinc-900/50 p-2 rounded overflow-x-auto">{event.sdpAnswer}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SipTimeline({ events }: { events: SipEvent[] }) {
  const sipEvents = events.filter((e) => e.type === 'sip');
  const infoEvents = events.filter((e) => e.type === 'info');
  const diagnostics = events.filter((e) => e.type === 'diagnostic');

  if (sipEvents.length === 0 && infoEvents.length === 0) {
    return (
      <div className="text-zinc-600 font-mono text-sm p-4">
        {'// Waiting for SIP transaction...'}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {events.map((event, i) => {
        if (event.type === 'sip') {
          return <SipMessageRow key={i} event={event} />;
        }
        if (event.type === 'diagnostic') {
          return (
            <div
              key={i}
              className={`flex items-start gap-2 py-1 px-2 rounded text-xs font-mono ${
                event.severity === 'error'
                  ? 'bg-red-950/30 text-red-400 border border-red-900/30'
                  : 'bg-yellow-950/30 text-yellow-400 border border-yellow-900/30'
              }`}
            >
              <span className="flex-shrink-0 mt-0.5">
                {event.severity === 'error' ? '!!' : '!'}{' '}
              </span>
              <span>{event.message}</span>
            </div>
          );
        }
        if (event.type === 'info' && event.message) {
          return (
            <div key={i} className="flex items-center gap-2 py-1 px-2 text-xs font-mono text-zinc-500">
              <span className="text-zinc-600">--</span>
              <span>{event.message}</span>
              {event.timestamp && (
                <span className="ml-auto text-zinc-700 tabular-nums">{formatTime(event.timestamp)}</span>
              )}
            </div>
          );
        }
        if (event.type === 'error' && event.message) {
          return (
            <div key={i} className="flex items-start gap-2 py-1 px-2 text-xs font-mono text-red-400">
              <span className="flex-shrink-0">!!</span>
              <span>{event.message}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
