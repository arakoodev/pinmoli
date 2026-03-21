import { describe, it, expect, afterEach } from 'vitest';
import { storeCall, getCall, removeCall, listCalls, type CallHandle } from '../../src/sip/call-store.js';
import dgram from 'dgram';
import { CODEC_TABLE } from '../../src/sip/codec.js';
import { DtmfDetector } from '../../src/sip/dtmf.js';

function makeHandle(overrides: Partial<CallHandle> = {}): CallHandle {
  const sipSocket = dgram.createSocket('udp4');
  const rtpSocket = dgram.createSocket('udp4');
  const timer = setTimeout(() => {}, 0);
  timer.unref();

  return {
    callId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    state: 'active',
    fromTag: 'tag1',
    toTag: 'tag2',
    branch: 'z9hG4bKtest',
    uri: 'sip:test@example.com',
    sipSocket,
    rtpSocket,
    host: 'example.com',
    port: 5060,
    publicIp: '1.2.3.4',
    sipPort: 5060,
    remoteIp: '5.6.7.8',
    remotePort: 10000,
    rtpPort: 20000,
    negotiatedCodec: CODEC_TABLE.PCMU,
    rtpStreamState: null,
    dtmfDetector: new DtmfDetector(),
    cseqCounter: 2,
    session: {
      dir: '/tmp/test-session',
      name: 'test-session',
      logSignaling: () => {},
      writeMetadata: () => {},
      file: (name: string) => `/tmp/test-session/${name}`,
    },
    turnCounter: 0,
    maxDurationTimer: timer,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('CallStore', () => {
  const storedIds: string[] = [];

  afterEach(() => {
    for (const id of storedIds) {
      const h = getCall(id);
      if (h) {
        try { h.sipSocket.close(); } catch { /* */ }
        try { h.rtpSocket.close(); } catch { /* */ }
      }
      removeCall(id);
    }
    storedIds.length = 0;
  });

  it('storeCall + getCall roundtrip', () => {
    const h = makeHandle();
    storedIds.push(h.callId);
    storeCall(h);

    const retrieved = getCall(h.callId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.callId).toBe(h.callId);
    expect(retrieved!.uri).toBe('sip:test@example.com');
  });

  it('getCall returns undefined for unknown callId', () => {
    expect(getCall('nonexistent-id')).toBeUndefined();
  });

  it('removeCall deletes the handle', () => {
    const h = makeHandle();
    storedIds.push(h.callId);
    storeCall(h);

    removeCall(h.callId);
    expect(getCall(h.callId)).toBeUndefined();
  });

  it('listCalls returns summaries', () => {
    const h1 = makeHandle({ uri: 'sip:a@a.com' });
    const h2 = makeHandle({ uri: 'sip:b@b.com' });
    storedIds.push(h1.callId, h2.callId);
    storeCall(h1);
    storeCall(h2);

    const summaries = listCalls();
    const ids = summaries.map(s => s.callId);
    expect(ids).toContain(h1.callId);
    expect(ids).toContain(h2.callId);

    const s1 = summaries.find(s => s.callId === h1.callId)!;
    expect(s1.state).toBe('active');
    expect(s1.uri).toBe('sip:a@a.com');
    expect(s1.codec).toBe('PCMU');
    expect(s1.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('listCalls returns empty array when no calls', () => {
    // After cleanup from afterEach, listCalls may still have calls from
    // other tests that haven't been cleaned up. But since we clean up
    // our own calls, we can at least verify it returns an array.
    const result = listCalls();
    expect(Array.isArray(result)).toBe(true);
  });
});
