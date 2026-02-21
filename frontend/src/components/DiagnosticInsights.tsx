'use client';

import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import type { SipEvent } from './SipTimeline';

interface DiagnosticInsightsProps {
  events: SipEvent[];
}

interface Insight {
  severity: 'error' | 'warning' | 'info';
  title: string;
  message: string;
}

function deriveInsights(events: SipEvent[]): Insight[] {
  const insights: Insight[] = [];
  const seen = new Set<string>();

  // Collect diagnostics from the engine
  for (const e of events) {
    if (e.type === 'diagnostic' && e.message) {
      const key = e.message.slice(0, 60);
      if (!seen.has(key)) {
        seen.add(key);
        insights.push({
          severity: (e.severity as 'error' | 'warning') || 'warning',
          title: e.severity === 'error' ? 'Protocol Issue' : 'Warning',
          message: e.message,
        });
      }
    }
  }

  // Derive higher-level insights from SIP event patterns
  const sipEvents = events.filter((e) => e.type === 'sip');
  const statuses = sipEvents.filter((e) => e.status).map((e) => e.status!);

  const has180 = statuses.includes(180);
  const has503 = statuses.includes(503);
  const has200 = statuses.includes(200);
  const has401 = statuses.includes(401);

  if (has180 && has503 && !has200) {
    const key = 'ringing-then-503';
    if (!seen.has(key)) {
      seen.add(key);
      insights.push({
        severity: 'error',
        title: 'Agent Timeout',
        message:
          '180 Ringing received but call ended with 503. The platform created a room but the AI agent never joined. Check: (1) Agent worker is running, (2) Dispatch rule matches agent name, (3) Agent is healthy and not crashing.',
      });
    }
  }

  if (has401) {
    const key = 'auth-required';
    if (!seen.has(key)) {
      seen.add(key);
      insights.push({
        severity: 'warning',
        title: 'Authentication Required',
        message: 'Server returned 401 Unauthorized. Provide credentials in the Auth tab and retry.',
      });
    }
  }

  if (has200 && !sipEvents.some((e) => e.method === 'ACK' && e.direction === 'out')) {
    const key = 'missing-ack';
    if (!seen.has(key)) {
      seen.add(key);
      insights.push({
        severity: 'error',
        title: 'Missing ACK',
        message: 'Received 200 OK but no ACK was sent. This will cause the remote to retransmit the 200 and eventually timeout.',
      });
    }
  }

  return insights;
}

export default function DiagnosticInsights({ events }: DiagnosticInsightsProps) {
  const insights = deriveInsights(events);

  if (insights.length === 0) {
    return (
      <div className="p-4 text-zinc-600 text-sm font-mono">
        {'// No diagnostic issues detected'}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      {insights.map((insight, i) => {
        const Icon = insight.severity === 'error' ? AlertCircle : insight.severity === 'warning' ? AlertTriangle : Info;
        const colors =
          insight.severity === 'error'
            ? 'bg-red-950/40 border-red-900/40 text-red-300'
            : insight.severity === 'warning'
              ? 'bg-yellow-950/40 border-yellow-900/40 text-yellow-300'
              : 'bg-blue-950/40 border-blue-900/40 text-blue-300';

        return (
          <div key={i} className={`rounded-lg border p-3 ${colors}`}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-semibold">{insight.title}</span>
            </div>
            <p className="text-xs opacity-90 ml-6 leading-relaxed">{insight.message}</p>
          </div>
        );
      })}
    </div>
  );
}
