/**
 * Session flow recording — builds structured flow.json from engine TestEvents.
 *
 * Instead of parsing sip-log.txt post-hoc, this module captures the event
 * stream directly from the SIP/WebRTC engine during test execution.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import type { TestEvent } from '../validation/schemas.js';
import type { Session } from './session.js';

// ---- Types ----

export interface FlowMessage {
  offsetMs: number;
  direction: 'sent' | 'received' | 'info';
  method?: string;
  status?: number;
  statusText?: string;
  message?: string;
}

export interface FlowRecord {
  protocol: 'sip' | 'webrtc';
  method?: string;
  uri?: string;
  startTime: string;
  durationMs: number;
  success: boolean;
  negotiatedCodec?: string;
  rtpPacketsSent: number;
  rtpPacketsReceived: number;
  messages: FlowMessage[];
  audioFiles: Record<string, string>;
}

// ---- Build flow from engine events ----

/**
 * Extract a structured FlowRecord from engine TestEvents collected during
 * a test run. Called after the async generator completes.
 */
export function buildFlowFromEvents(
  events: TestEvent[],
  opts: {
    protocol: 'sip' | 'webrtc';
    method?: string;
    uri?: string;
  },
): FlowRecord {
  if (events.length === 0) {
    return {
      protocol: opts.protocol,
      method: opts.method,
      uri: opts.uri,
      startTime: new Date().toISOString(),
      durationMs: 0,
      success: false,
      rtpPacketsSent: 0,
      rtpPacketsReceived: 0,
      messages: [],
      audioFiles: {},
    };
  }

  const t0 = events[0].timestamp;
  const tLast = events[events.length - 1].timestamp;
  const messages: FlowMessage[] = [];
  let negotiatedCodec: string | undefined;
  let rtpPacketsSent = 0;
  let rtpPacketsReceived = 0;
  const audioFiles: Record<string, string> = {};
  let success = true;

  for (const ev of events) {
    const offsetMs = ev.timestamp - t0;

    // SIP/WebRTC signaling messages
    if (ev.type === 'sip' || ev.type === 'webrtc') {
      if (ev.method) {
        // Outbound SIP method (INVITE, ACK, BYE, CANCEL, OPTIONS)
        messages.push({ offsetMs, direction: 'sent', method: ev.method });
      } else if (ev.status) {
        // Inbound SIP response (100, 180, 200, etc.)
        const statusText = extractStatusText(ev.message);
        messages.push({ offsetMs, direction: 'received', status: ev.status, statusText });
      } else if (ev.message.includes('WHIP offer')) {
        messages.push({ offsetMs, direction: 'sent', method: 'WHIP_OFFER' });
      } else if (ev.message.includes('SDP answer')) {
        messages.push({ offsetMs, direction: 'received', method: 'WHIP_ANSWER' });
      } else if (ev.message.startsWith('Sending ')) {
        // "Sending INVITE request..." or "Sending ACK" — extract method
        const methodMatch = ev.message.match(/^Sending\s+(\w+)/);
        if (methodMatch) {
          messages.push({ offsetMs, direction: 'sent', method: methodMatch[1] });
        }
      } else if (ev.message.startsWith('Received ')) {
        // "Received 200 OK" — already covered by ev.status branch
        // "Received SDP answer" — info about signaling
        messages.push({ offsetMs, direction: 'received', message: ev.message });
      } else if (ev.message.includes('ICE connected')) {
        messages.push({ offsetMs, direction: 'info', message: 'ICE connected' });
      } else if (ev.message.includes('Session ended')) {
        messages.push({ offsetMs, direction: 'sent', method: 'WHIP_DELETE' });
      } else if (ev.message === 'Call terminated') {
        messages.push({ offsetMs, direction: 'info', message: 'Call terminated' });
      } else if (ev.message.includes('CANCEL')) {
        messages.push({ offsetMs, direction: 'sent', method: 'CANCEL' });
      }
    }

    // Info events — extract RTP stats, codec negotiation, audio files
    if (ev.type === 'info') {
      // Codec negotiation
      const codecMatch = ev.message.match(/^Codec negotiated:\s+(\S+)/);
      if (codecMatch) {
        negotiatedCodec = codecMatch[1];
      }

      // RTP packet counts
      const sentMatch = ev.message.match(/^Sent (\d+) (?:RTP packets|frames)/);
      if (sentMatch) {
        rtpPacketsSent += parseInt(sentMatch[1]);
      }

      const recvMatch = ev.message.match(/^Received (\d+) (?:RTP packets|greeting (?:RTP )?packets|packets) from agent/);
      if (recvMatch) {
        rtpPacketsReceived += parseInt(recvMatch[1]);
      } else {
        // Greeting packets without "from agent" suffix
        const greetingRecvMatch = ev.message.match(/^Received (\d+) greeting (?:RTP )?packets/);
        if (greetingRecvMatch) {
          rtpPacketsReceived += parseInt(greetingRecvMatch[1]);
        }
      }

      // Audio file references
      if (ev.message.includes('greeting saved')) {
        const fileMatch = ev.message.match(/:\s+(.+)$/);
        if (fileMatch) audioFiles.agentGreeting = extractFilename(fileMatch[1]);
      }
      if (ev.message.includes('response saved') || ev.message.includes('Response saved')) {
        const fileMatch = ev.message.match(/:\s+(.+)$/);
        if (fileMatch) audioFiles.agentResponse = extractFilename(fileMatch[1]);
      }
      if (ev.message.includes('Outbound audio saved')) {
        const fileMatch = ev.message.match(/:\s+(.+)$/);
        if (fileMatch) audioFiles.sent = extractFilename(fileMatch[1]);
      }

      // Listening/sending phase markers (useful for replay comparison)
      if (ev.message.match(/^Listening for (agent greeting|agent response|response)/)) {
        messages.push({ offsetMs, direction: 'info', message: ev.message });
      }
      if (ev.message.match(/^Sending audio/)) {
        messages.push({ offsetMs, direction: 'info', message: ev.message });
      }
    }

    // DTMF events
    if (ev.type === 'dtmf') {
      const dir = ev.message.startsWith('Sent') ? 'sent' : 'received';
      messages.push({ offsetMs, direction: dir, message: ev.message });
    }

    // Error events
    if (ev.type === 'error') {
      success = false;
      messages.push({ offsetMs, direction: 'info', message: ev.message });
    }
  }

  return {
    protocol: opts.protocol,
    method: opts.method,
    uri: opts.uri,
    startTime: new Date(t0).toISOString(),
    durationMs: tLast - t0,
    success,
    negotiatedCodec,
    rtpPacketsSent,
    rtpPacketsReceived,
    messages,
    audioFiles,
  };
}

// ---- Write / Read flow.json ----

/**
 * Write flow.json to the test session directory.
 */
export function writeFlowJson(session: Session, flow: FlowRecord): void {
  writeFileSync(session.file('flow.json'), JSON.stringify(flow, null, 2) + '\n');
}

/**
 * Read flow.json from a test directory path.
 * Returns null if the file doesn't exist.
 */
export function readFlowJson(testDirPath: string): FlowRecord | null {
  const flowPath = testDirPath.endsWith('flow.json')
    ? testDirPath
    : `${testDirPath}/flow.json`;

  if (!existsSync(flowPath)) return null;
  try {
    return JSON.parse(readFileSync(flowPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---- Display helpers ----

/**
 * Format a flow record as a human-readable timeline.
 */
export function formatFlow(flow: FlowRecord): string {
  const lines: string[] = [];

  for (const msg of flow.messages) {
    const offset = `+${(msg.offsetMs / 1000).toFixed(3)}s`;

    if (msg.direction === 'sent') {
      const label = msg.method || msg.message || '';
      lines.push(`    ${offset.padEnd(12)} >>> ${label}`);
    } else if (msg.direction === 'received') {
      const label = msg.status
        ? `${msg.status} ${msg.statusText || ''}`.trim()
        : (msg.method || msg.message || '');
      lines.push(`    ${offset.padEnd(12)} <<< ${label}`);
    } else {
      // info
      lines.push(`    ${offset.padEnd(12)}     ${msg.message || ''}`);
    }
  }

  const stats: string[] = [];
  stats.push(`${(flow.durationMs / 1000).toFixed(1)}s`);
  if (flow.rtpPacketsSent > 0 || flow.rtpPacketsReceived > 0) {
    stats.push(`${flow.rtpPacketsSent} sent / ${flow.rtpPacketsReceived} received`);
  }
  if (flow.negotiatedCodec) {
    stats.push(flow.negotiatedCodec);
  }
  lines.push(`    ${flow.success ? 'OK' : 'FAILED'}: ${stats.join(', ')}`);

  return lines.join('\n');
}

/**
 * Compare two flow records (original vs replay).
 * Returns a human-readable diff string.
 */
export function compareFlows(original: FlowRecord, replay: FlowRecord): string {
  const lines: string[] = [];

  // Compare message sequences (methods/statuses only — ignore info messages)
  const origSeq = extractSequence(original);
  const replaySeq = extractSequence(replay);

  if (origSeq === replaySeq) {
    lines.push('  Sequence: MATCH');
  } else {
    lines.push('  Sequence: DIFFER');
    lines.push(`    Original: ${origSeq}`);
    lines.push(`    Replay:   ${replaySeq}`);
  }

  // Timing delta
  const timingDelta = replay.durationMs - original.durationMs;
  const sign = timingDelta >= 0 ? '+' : '';
  lines.push(`  Timing delta: ${sign}${(timingDelta / 1000).toFixed(1)}s`);

  // RTP comparison
  if (original.rtpPacketsSent > 0 || replay.rtpPacketsSent > 0) {
    lines.push(`  RTP sent: ${original.rtpPacketsSent} → ${replay.rtpPacketsSent}`);
    lines.push(`  RTP received: ${original.rtpPacketsReceived} → ${replay.rtpPacketsReceived}`);
  }

  // Codec match
  if (original.negotiatedCodec && replay.negotiatedCodec) {
    if (original.negotiatedCodec === replay.negotiatedCodec) {
      lines.push(`  Codec: ${original.negotiatedCodec} (match)`);
    } else {
      lines.push(`  Codec: ${original.negotiatedCodec} → ${replay.negotiatedCodec} (CHANGED)`);
    }
  }

  return lines.join('\n');
}

// ---- Internal helpers ----

/**
 * Extract the signaling sequence (methods and status codes) for comparison.
 */
function extractSequence(flow: FlowRecord): string {
  return flow.messages
    .filter(m => m.method || m.status)
    .map(m => m.method || `${m.status}`)
    .join(' → ');
}

/**
 * Extract status text from an event message like "Received 200 OK".
 */
function extractStatusText(message: string): string {
  const match = message.match(/^Received\s+\d+\s+(.*)/);
  return match ? match[1].trim() : '';
}

/**
 * Extract just the filename from a full path.
 */
function extractFilename(path: string): string {
  return path.split('/').pop() || path;
}
