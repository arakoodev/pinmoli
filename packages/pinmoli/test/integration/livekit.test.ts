import { describe, it, expect } from 'vitest';
import { executeSipTest } from '../../src/sip/transport.js';

describe('LiveKit Integration', () => {
  const LIVEKIT_ENDPOINT = 'sip:5eezfwavhxe.sip.livekit.cloud';

  it('connects to LiveKit with OPTIONS', async () => {
    const config = {
      uri: LIVEKIT_ENDPOINT,
      method: 'OPTIONS' as const,
      codecs: ['opus' as const, 'PCMU' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 10000
    };

    const events = [];
    for await (const event of executeSipTest(config)) {
      events.push(event);
    }

    // Verify event sequence
    expect(events.length).toBeGreaterThan(0);
    
    const networkEvents = events.filter(e => e.type === 'network');
    expect(networkEvents.length).toBeGreaterThanOrEqual(2);
    expect(networkEvents[0].message).toContain('Resolving');
    expect(networkEvents[1].message).toContain('Bound to');

    const sipEvents = events.filter(e => e.type === 'sip');
    expect(sipEvents.length).toBeGreaterThanOrEqual(2);
    expect(sipEvents[0].message).toContain('Sending OPTIONS');
    
    // Verify successful response
    const responseEvent = sipEvents.find(e => e.status);
    expect(responseEvent).toBeDefined();
    expect(responseEvent!.status).toBe(200);
    expect(responseEvent!.message).toContain('OK');
  }, 15000);

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
