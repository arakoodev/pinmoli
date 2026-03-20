import { describe, it, expect } from 'vitest';
import { buildFlowFromEvents, formatFlow, compareFlows } from '../../src/network/flow.js';
import type { TestEvent } from '../../src/validation/schemas.js';

describe('buildFlowFromEvents', () => {
  const t0 = 1710000000000;

  function mkEvent(partial: Partial<TestEvent> & { type: TestEvent['type']; message: string }): TestEvent {
    return { timestamp: t0, ...partial };
  }

  it('builds SIP INVITE flow from typical event sequence', () => {
    const events: TestEvent[] = [
      mkEvent({ type: 'info', message: 'Starting SIP INVITE test to sip:+1234@host', timestamp: t0 }),
      mkEvent({ type: 'info', message: 'Resolved: host:5060 — session: sip-invite-host-20260320', timestamp: t0 + 10 }),
      mkEvent({ type: 'sip', message: 'Sending INVITE request...', method: 'INVITE', timestamp: t0 + 100 }),
      mkEvent({ type: 'sip', message: 'Received 100 Processing', status: 100, timestamp: t0 + 200 }),
      mkEvent({ type: 'sip', message: 'Received 180 Ringing', status: 180, timestamp: t0 + 2000 }),
      mkEvent({ type: 'sip', message: 'Received 200 OK', status: 200, timestamp: t0 + 5000 }),
      mkEvent({ type: 'info', message: 'Codec negotiated: PCMU (PT=0, clock=8000Hz)', timestamp: t0 + 5010 }),
      mkEvent({ type: 'sip', message: 'Sending ACK', timestamp: t0 + 5020 }),
      mkEvent({ type: 'info', message: 'Listening for agent greeting on port 10000 (5s)...', timestamp: t0 + 5030 }),
      mkEvent({ type: 'info', message: 'Received 500 greeting RTP packets from agent', timestamp: t0 + 10030 }),
      mkEvent({ type: 'info', message: 'Sending audio as PCMU (voice-hello) to host:10000 from port 10000', timestamp: t0 + 10040 }),
      mkEvent({ type: 'info', message: 'Sent 150 RTP packets', timestamp: t0 + 13040 }),
      mkEvent({ type: 'info', message: 'Listening for agent response on port 10000 (15s)...', timestamp: t0 + 13050 }),
      mkEvent({ type: 'info', message: 'Received 1247 RTP packets from agent', timestamp: t0 + 28050 }),
      mkEvent({ type: 'sip', message: 'Sending BYE', timestamp: t0 + 28060 }),
      mkEvent({ type: 'info', message: 'Test completed successfully in 28060ms — session: /app/captures/test', timestamp: t0 + 28070 }),
    ];

    const flow = buildFlowFromEvents(events, { protocol: 'sip', method: 'INVITE', uri: 'sip:+1234@host' });

    expect(flow.protocol).toBe('sip');
    expect(flow.method).toBe('INVITE');
    expect(flow.uri).toBe('sip:+1234@host');
    expect(flow.success).toBe(true);
    expect(flow.negotiatedCodec).toBe('PCMU');
    expect(flow.rtpPacketsSent).toBe(150);
    expect(flow.rtpPacketsReceived).toBe(1747); // 500 greeting + 1247 response
    expect(flow.durationMs).toBe(28070);

    // Check message sequence
    const methods = flow.messages.filter(m => m.method).map(m => m.method);
    expect(methods).toEqual(['INVITE', 'ACK', 'BYE']);

    const statuses = flow.messages.filter(m => m.status).map(m => m.status);
    expect(statuses).toEqual([100, 180, 200]);
  });

  it('builds SIP OPTIONS flow', () => {
    const events: TestEvent[] = [
      mkEvent({ type: 'info', message: 'Starting SIP OPTIONS test', timestamp: t0 }),
      mkEvent({ type: 'sip', message: 'Sending OPTIONS request...', method: 'OPTIONS', timestamp: t0 + 50 }),
      mkEvent({ type: 'sip', message: 'Received 200 OK', status: 200, timestamp: t0 + 500 }),
      mkEvent({ type: 'info', message: 'Test completed successfully in 500ms — session: /tmp/test', timestamp: t0 + 510 }),
    ];

    const flow = buildFlowFromEvents(events, { protocol: 'sip', method: 'OPTIONS', uri: 'sip:host' });

    expect(flow.success).toBe(true);
    expect(flow.durationMs).toBe(510);
    expect(flow.messages.filter(m => m.method)).toHaveLength(1);
    expect(flow.messages.find(m => m.method === 'OPTIONS')).toBeTruthy();
    expect(flow.messages.find(m => m.status === 200)).toBeTruthy();
  });

  it('builds WebRTC flow from WHIP events', () => {
    const events: TestEvent[] = [
      mkEvent({ type: 'info', message: 'Starting WebRTC test — session: webrtc-whip-host-20260320', timestamp: t0 }),
      mkEvent({ type: 'webrtc', message: 'Sending WHIP offer to https://host/whip', timestamp: t0 + 100 }),
      mkEvent({ type: 'webrtc', message: 'Received SDP answer', sdpAnswer: 'v=0...', timestamp: t0 + 300 }),
      mkEvent({ type: 'webrtc', message: 'ICE connected (state: connected)', timestamp: t0 + 1000 }),
      mkEvent({ type: 'info', message: 'Sent 200 frames (4.0s of audio)', timestamp: t0 + 5000 }),
      mkEvent({ type: 'info', message: 'Received 300 packets from agent', timestamp: t0 + 15000 }),
      mkEvent({ type: 'webrtc', message: 'Session ended (WHIP DELETE)', timestamp: t0 + 15100 }),
      mkEvent({ type: 'info', message: 'Test complete (15100ms)', timestamp: t0 + 15100 }),
    ];

    const flow = buildFlowFromEvents(events, { protocol: 'webrtc', uri: 'https://host/whip' });

    expect(flow.protocol).toBe('webrtc');
    expect(flow.success).toBe(true);
    expect(flow.rtpPacketsSent).toBe(200);
    expect(flow.rtpPacketsReceived).toBe(300);

    const whipMethods = flow.messages.filter(m => m.method).map(m => m.method);
    expect(whipMethods).toContain('WHIP_OFFER');
    expect(whipMethods).toContain('WHIP_ANSWER');
    expect(whipMethods).toContain('WHIP_DELETE');
  });

  it('marks flow as failed on error events', () => {
    const events: TestEvent[] = [
      mkEvent({ type: 'info', message: 'Starting SIP INVITE test', timestamp: t0 }),
      mkEvent({ type: 'sip', message: 'Sending INVITE request...', method: 'INVITE', timestamp: t0 + 100 }),
      mkEvent({ type: 'error', message: 'Request timeout', severity: 'fatal', code: 'TIMEOUT', timestamp: t0 + 5100 }),
    ];

    const flow = buildFlowFromEvents(events, { protocol: 'sip', method: 'INVITE', uri: 'sip:host' });

    expect(flow.success).toBe(false);
    expect(flow.messages.some(m => m.message === 'Request timeout')).toBe(true);
  });

  it('handles empty events', () => {
    const flow = buildFlowFromEvents([], { protocol: 'sip', method: 'OPTIONS' });

    expect(flow.success).toBe(false);
    expect(flow.durationMs).toBe(0);
    expect(flow.messages).toHaveLength(0);
  });

  it('captures DTMF events', () => {
    const events: TestEvent[] = [
      mkEvent({ type: 'info', message: 'Starting', timestamp: t0 }),
      mkEvent({ type: 'dtmf', message: 'Sent DTMF digit: 1', dtmfDigit: '1', timestamp: t0 + 100 }),
      mkEvent({ type: 'dtmf', message: 'Received DTMF digit: 5', dtmfDigit: '5', timestamp: t0 + 200 }),
    ];

    const flow = buildFlowFromEvents(events, { protocol: 'sip', method: 'INVITE' });

    const dtmfMsgs = flow.messages.filter(m => m.message?.includes('DTMF'));
    expect(dtmfMsgs).toHaveLength(2);
    expect(dtmfMsgs[0].direction).toBe('sent');
    expect(dtmfMsgs[1].direction).toBe('received');
  });
});

describe('formatFlow', () => {
  it('formats a flow as human-readable timeline', () => {
    const flow = buildFlowFromEvents([
      { type: 'info', timestamp: 1000, message: 'Start' },
      { type: 'sip', timestamp: 1100, message: 'Sending INVITE request...', method: 'INVITE' },
      { type: 'sip', timestamp: 1200, message: 'Received 200 OK', status: 200 },
    ], { protocol: 'sip', method: 'INVITE' });

    const output = formatFlow(flow);

    expect(output).toContain('>>>');
    expect(output).toContain('<<<');
    expect(output).toContain('INVITE');
    expect(output).toContain('200');
  });
});

describe('compareFlows', () => {
  it('detects matching sequences', () => {
    const flow1 = buildFlowFromEvents([
      { type: 'info', timestamp: 1000, message: 'Start' },
      { type: 'sip', timestamp: 1100, message: 'Sending INVITE', method: 'INVITE' },
      { type: 'sip', timestamp: 1200, message: 'Received 200 OK', status: 200 },
    ], { protocol: 'sip', method: 'INVITE' });

    const flow2 = buildFlowFromEvents([
      { type: 'info', timestamp: 2000, message: 'Start' },
      { type: 'sip', timestamp: 2150, message: 'Sending INVITE', method: 'INVITE' },
      { type: 'sip', timestamp: 2300, message: 'Received 200 OK', status: 200 },
    ], { protocol: 'sip', method: 'INVITE' });

    const result = compareFlows(flow1, flow2);
    expect(result).toContain('Sequence: MATCH');
  });

  it('detects differing sequences', () => {
    const flow1 = buildFlowFromEvents([
      { type: 'info', timestamp: 1000, message: 'Start' },
      { type: 'sip', timestamp: 1100, message: 'Sending INVITE', method: 'INVITE' },
      { type: 'sip', timestamp: 1200, message: 'Received 200 OK', status: 200 },
    ], { protocol: 'sip', method: 'INVITE' });

    const flow2 = buildFlowFromEvents([
      { type: 'info', timestamp: 2000, message: 'Start' },
      { type: 'sip', timestamp: 2100, message: 'Sending INVITE', method: 'INVITE' },
      { type: 'sip', timestamp: 2200, message: 'Received 503 Service Unavailable', status: 503 },
    ], { protocol: 'sip', method: 'INVITE' });

    const result = compareFlows(flow1, flow2);
    expect(result).toContain('Sequence: DIFFER');
  });

  it('shows timing delta', () => {
    const flow1 = buildFlowFromEvents([
      { type: 'info', timestamp: 1000, message: 'Start' },
      { type: 'info', timestamp: 2000, message: 'End' },
    ], { protocol: 'sip' });

    const flow2 = buildFlowFromEvents([
      { type: 'info', timestamp: 3000, message: 'Start' },
      { type: 'info', timestamp: 4500, message: 'End' },
    ], { protocol: 'sip' });

    const result = compareFlows(flow1, flow2);
    expect(result).toContain('Timing delta: +0.5s');
  });
});
