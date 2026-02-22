import { describe, it, expect } from 'vitest';
import { executeSipTest } from '../../src/sip/transport.js';

describe('Generic SIP Integration', () => {
  it('handles invalid endpoint gracefully', async () => {
    const config = {
      uri: 'sip:nonexistent.invalid.test',
      method: 'OPTIONS' as const,
      codecs: ['opus' as const, 'PCMU' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 1000
    };

    const events = [];
    try {
      for await (const event of executeSipTest(config)) {
        events.push(event);
        if (events.length > 10) break; // Prevent infinite loop
      }
    } catch (error) {
      // Expected to fail
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === 'network' || e.type === 'error')).toBe(true);
  });

  it('validates SIP URI format', async () => {
    const config = {
      uri: 'not-a-sip-uri',
      method: 'OPTIONS' as const,
      codecs: ['opus' as const],
      transport: 'udp' as const,
      timeout: 1000
    };

    const events = [];
    try {
      for await (const event of executeSipTest(config)) {
        events.push(event);
        if (events.length > 5) break;
      }
    } catch (error) {
      events.push({
        type: 'error',
        timestamp: Date.now(),
        message: error instanceof Error ? error.message : String(error)
      });
    }

    expect(events.some(e => e.type === 'error')).toBe(true);
  });

  it('respects timeout setting', async () => {
    const config = {
      uri: 'sip:timeout.test.invalid',
      method: 'OPTIONS' as const,
      codecs: ['opus' as const],
      transport: 'udp' as const,
      timeout: 500
    };

    const start = Date.now();
    const events = [];
    
    try {
      for await (const event of executeSipTest(config)) {
        events.push(event);
      }
    } catch (error) {
      // Expected
    }

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000); // Should timeout quickly
  });
});


  it('sends INVITE to LiveKit', async () => {
    const config = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE' as const,
      codecs: ['opus' as const, 'PCMU' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 15000
    };

    const events = [];
    for await (const event of executeSipTest(config)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);

    // Verify SDP offer was sent
    const offerEvent = events.find(e => e.sdpOffer);
    expect(offerEvent).toBeDefined();
    expect(offerEvent!.sdpOffer).toContain('v=0');
    expect(offerEvent!.sdpOffer).toContain('opus');

    // Verify INVITE was sent
    const inviteEvent = events.find(e => e.method === 'INVITE');
    expect(inviteEvent).toBeDefined();

    // Verify response (100 Trying or 200 OK)
    const responseEvent = events.find(e => e.status);
    expect(responseEvent).toBeDefined();
    expect([100, 200]).toContain(responseEvent!.status);
  }, 20000);

  it('handles timeout gracefully', async () => {
    const config = {
      uri: 'sip:nonexistent.invalid',
      method: 'OPTIONS' as const,
      codecs: ['opus' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 2000
    };

    await expect(async () => {
      const events = [];
      for await (const event of executeSipTest(config)) {
        events.push(event);
      }
    }).rejects.toThrow(/timeout/i);
  }, 5000);

  it('validates SIP URI format', async () => {
    const config = {
      uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
      method: 'OPTIONS' as const,
      codecs: ['opus' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 10000
    };

    const events = [];
    for await (const event of executeSipTest(config)) {
      events.push(event);
    }

    const resolveEvent = events.find(e => e.message.includes('Resolving'));
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent!.message).toContain('5eezfwavhxe.sip.livekit.cloud');
    expect(resolveEvent!.message).toContain('5060');
  }, 15000);

  it('generates valid SDP with multiple codecs', async () => {
    const config = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE' as const,
      codecs: ['opus' as const, 'PCMU' as const, 'PCMA' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 15000
    };

    const events = [];
    for await (const event of executeSipTest(config)) {
      events.push(event);
    }

    const sdpEvent = events.find(e => e.sdpOffer);
    expect(sdpEvent).toBeDefined();
    
    const sdp = sdpEvent!.sdpOffer!;
    expect(sdp).toContain('v=0');
    expect(sdp).toContain('m=audio');
    expect(sdp).toContain('opus');
    expect(sdp).toContain('PCMU');
    expect(sdp).toContain('PCMA');
    expect(sdp).toContain('a=rtpmap:111 opus/48000/2');
    expect(sdp).toContain('a=rtpmap:0 PCMU/8000');
    expect(sdp).toContain('a=rtpmap:8 PCMA/8000');
  }, 20000);

  it('uses correct media port', async () => {
    const customPort = 12345;
    const config = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE' as const,
      codecs: ['opus' as const],
      transport: 'udp' as const,
      mediaPort: customPort,
      timeout: 15000
    };

    const events = [];
    for await (const event of executeSipTest(config)) {
      events.push(event);
    }

    const sdpEvent = events.find(e => e.sdpOffer);
    expect(sdpEvent).toBeDefined();
    expect(sdpEvent!.sdpOffer).toContain(`m=audio ${customPort}`);
  }, 20000);
});
