import { describe, it, expect } from 'vitest';
import { runSipTest } from '../../src/sip/engine.js';

/**
 * Engine-level integration tests for codec negotiation.
 * These test that the SDP offer contains the correct codec lines
 * based on the codecs config passed to runSipTest.
 */

describe('Codec in SDP offer', () => {
  it('SDP includes requested PCMA codec', async () => {
    const config = {
      uri: 'sip:codec-test.invalid',
      method: 'INVITE' as const,
      codecs: ['PCMA' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 500,
    };

    const events = [];
    try {
      for await (const event of runSipTest(config)) {
        events.push(event);
        if (events.length > 10) break;
      }
    } catch {
      // Expected — invalid host
    }

    // Find the SIP event with the SDP offer
    const sipEvent = events.find(e => e.sdpOffer);
    expect(sipEvent).toBeDefined();
    expect(sipEvent!.sdpOffer).toContain('a=rtpmap:8 PCMA/8000');
    // Should NOT contain PCMU since we only asked for PCMA
    expect(sipEvent!.sdpOffer).not.toContain('a=rtpmap:0 PCMU/8000');
    // Should still have telephone-event
    expect(sipEvent!.sdpOffer).toContain('a=rtpmap:101 telephone-event/8000');
  });

  it('SDP includes multiple codecs', async () => {
    const config = {
      uri: 'sip:codec-test.invalid',
      method: 'INVITE' as const,
      codecs: ['G722' as const, 'PCMU' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 500,
    };

    const events = [];
    try {
      for await (const event of runSipTest(config)) {
        events.push(event);
        if (events.length > 10) break;
      }
    } catch {
      // Expected
    }

    const sipEvent = events.find(e => e.sdpOffer);
    expect(sipEvent).toBeDefined();
    // Both PCMU (0) and G722 (9) should be in the m= line, plus telephone-event (101)
    expect(sipEvent!.sdpOffer).toContain('a=rtpmap:9 G722/8000');
    expect(sipEvent!.sdpOffer).toContain('a=rtpmap:0 PCMU/8000');
    expect(sipEvent!.sdpOffer).toContain('a=rtpmap:101 telephone-event/8000');
    // m= line should list both payload types
    expect(sipEvent!.sdpOffer).toMatch(/m=audio \d+ RTP\/AVP [\d ]*9[\d ]*101/);
    expect(sipEvent!.sdpOffer).toMatch(/m=audio \d+ RTP\/AVP [\d ]*0[\d ]*101/);
  });

  it('handles PCMA-only codec config', async () => {
    const config = {
      uri: 'sip:codec-test.invalid',
      method: 'INVITE' as const,
      codecs: ['PCMA' as const],
      transport: 'udp' as const,
      mediaPort: 10000,
      timeout: 500,
    };

    const events = [];
    try {
      for await (const event of runSipTest(config)) {
        events.push(event);
        if (events.length > 10) break;
      }
    } catch {
      // Expected
    }

    // First event should be "Starting SIP INVITE test"
    expect(events[0].message).toContain('Starting SIP INVITE test');

    const sipEvent = events.find(e => e.sdpOffer);
    expect(sipEvent).toBeDefined();
    // m= line should only have PCMA (8) and telephone-event (101)
    expect(sipEvent!.sdpOffer).toMatch(/m=audio \d+ RTP\/AVP 8 101/);
    // Only PCMA + telephone-event rtpmap lines
    expect(sipEvent!.sdpOffer).toContain('a=rtpmap:8 PCMA/8000');
    expect(sipEvent!.sdpOffer).not.toContain('a=rtpmap:0 PCMU/8000');
    expect(sipEvent!.sdpOffer).not.toContain('a=rtpmap:9 G722/8000');
  });
});
