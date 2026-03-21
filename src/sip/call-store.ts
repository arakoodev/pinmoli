/**
 * In-memory call handle store for interactive multi-turn SIP calls.
 *
 * All tools run in the same Node.js process, so a simple Map<callId, CallHandle>
 * is sufficient. No filesystem serialization needed for sockets.
 */

import dgram from 'dgram';
import type { CodecInfo } from './codec.js';
import type { RtpStreamState } from './rtp-receiver.js';
import type { DtmfDetector } from './dtmf.js';
import type { Session } from '../network/session.js';

export interface CallHandle {
  callId: string;
  state: 'connecting' | 'ringing' | 'active' | 'terminated';
  // SIP dialog
  fromTag: string;
  toTag: string;
  branch: string;
  uri: string;
  // Network
  sipSocket: dgram.Socket;
  rtpSocket: dgram.Socket;
  host: string;
  port: number;
  publicIp: string;
  sipPort: number;
  remoteIp: string;
  remotePort: number;
  rtpPort: number;
  // Media
  negotiatedCodec: CodecInfo;
  rtpStreamState: RtpStreamState | null; // null until first send
  dtmfDetector: DtmfDetector;
  // Tracking
  cseqCounter: number; // INVITE=1, ACK=1, BYE=next
  session: Session;
  turnCounter: number; // for naming: agent-response-1.wav, sent-audio-2.wav
  maxDurationTimer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

export interface CallSummary {
  callId: string;
  state: CallHandle['state'];
  uri: string;
  codec: string;
  turnCounter: number;
  durationMs: number;
}

// Module-level singleton
const activeCalls = new Map<string, CallHandle>();

export function storeCall(handle: CallHandle): void {
  activeCalls.set(handle.callId, handle);
}

export function getCall(callId: string): CallHandle | undefined {
  return activeCalls.get(callId);
}

export function removeCall(callId: string): void {
  activeCalls.delete(callId);
}

export function listCalls(): CallSummary[] {
  const now = Date.now();
  return Array.from(activeCalls.values()).map(h => ({
    callId: h.callId,
    state: h.state,
    uri: h.uri,
    codec: h.negotiatedCodec.name,
    turnCounter: h.turnCounter,
    durationMs: now - h.createdAt,
  }));
}

export async function terminateAll(): Promise<void> {
  // Lazy import to avoid circular dependency with call-session.ts
  const { closeDialog } = await import('./call-session.js');
  const handles = Array.from(activeCalls.values());
  for (const handle of handles) {
    if (handle.state !== 'terminated') {
      try {
        await closeDialog(handle, () => {});
      } catch { /* best-effort cleanup */ }
    }
  }
}
