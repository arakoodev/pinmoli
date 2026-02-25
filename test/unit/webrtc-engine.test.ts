import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWebRtcTest } from '../../src/webrtc/engine.js';
import type { WebRtcTestConfig, TestEvent } from '../../src/validation/schemas.js';

// Helper to collect all events from the async generator
async function collectEvents(config: WebRtcTestConfig): Promise<TestEvent[]> {
  const events: TestEvent[] = [];
  for await (const event of runWebRtcTest(config)) {
    events.push(event);
  }
  return events;
}

describe('WebRTC Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('yields error event on WHIP HTTP failure', async () => {
    // Mock fetch to return 401
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const events = await collectEvents({
      whipEndpoint: 'https://example.com/whip',
      bearerToken: 'bad-token',
      timeout: 5000,
    });

    // Should have info events + error event
    expect(events.length).toBeGreaterThan(0);

    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.code).toBe('WHIP_HTTP_ERROR');
    expect(errorEvent!.recovery).toContain('WHIP endpoint');
  });

  it('yields starting info event', async () => {
    // Mock fetch to return 401 (test will stop at WHIP stage)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const events = await collectEvents({
      whipEndpoint: 'https://example.com/whip',
      timeout: 5000,
    });

    const infoEvents = events.filter(e => e.type === 'info');
    expect(infoEvents.length).toBeGreaterThan(0);
    expect(infoEvents[0].message).toContain('Starting WebRTC test');
  });

  it('includes endpoint URL in starting message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const endpoint = 'https://myproject.livekit.cloud/whip';
    const events = await collectEvents({
      whipEndpoint: endpoint,
      timeout: 5000,
    });

    const startEvent = events.find(e => e.message.includes('Starting'));
    expect(startEvent).toBeDefined();
    expect(startEvent!.message).toContain(endpoint);
  });

  it('yields webrtc type for WHIP offer event', async () => {
    // Mock fetch to fail at WHIP stage
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
    );

    const events = await collectEvents({
      whipEndpoint: 'https://example.com/whip',
      timeout: 5000,
    });

    // Even on failure, we should see the webrtc event for the offer attempt
    // The offer is sent before the error
    const webrtcEvent = events.find(e => e.type === 'webrtc');
    expect(webrtcEvent).toBeDefined();
    expect(webrtcEvent!.message).toContain('WHIP offer');
    expect(webrtcEvent!.rawMessage).toContain('v=0');
  });

  it('uses default codec opus', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Bad', { status: 400, statusText: 'Bad Request' })
    );

    const events = await collectEvents({
      whipEndpoint: 'https://example.com/whip',
      timeout: 5000,
    });

    const transceiverEvent = events.find(e => e.message.includes('transceiver'));
    expect(transceiverEvent).toBeDefined();
    expect(transceiverEvent!.message).toContain('opus');
  });
});
