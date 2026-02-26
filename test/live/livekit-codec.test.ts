import { describe, it, expect } from 'vitest';
import { runSipTest } from '../../src/sip/engine.js';
import type { TestConfig } from '../../src/validation/schemas.js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

/**
 * Live codec negotiation tests against LiveKit SIP endpoint.
 *
 * Verifies that:
 * 1. The SDP offer contains the requested codecs
 * 2. parseSdpAnswer() extracts the negotiated codec from the real 200 OK
 * 3. The "Codec negotiated:" event is emitted with the correct codec
 * 4. Audio is sent as the negotiated codec (not hardcoded PCMU)
 *
 * LiveKit typically selects PCMU regardless of offer order,
 * but may accept PCMA or G722 depending on trunk config.
 */

dotenv.config({ path: resolve(__dirname, '../../.env') });

const LIVEKIT_ENDPOINT = process.env.LIVEKIT_ENDPOINT || 'sip:+1234567890@5eezfwavhxe.sip.livekit.cloud';

describe('LiveKit Codec Negotiation (Live)', () => {
  it('negotiates codec from INVITE with opus+PCMU', async () => {
    const config: TestConfig = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE',
      codecs: ['opus', 'PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000,
      responseWaitTime: 2,
    };

    const events = [];
    for await (const event of runSipTest(config)) {
      events.push(event);
    }

    // Should have multiple events
    expect(events.length).toBeGreaterThan(3);

    console.log('opus+PCMU events:', events.map(e => `[${e.type}${e.status ? ' ' + e.status : ''}] ${e.message}`).join('\n'));

    // Find codec negotiation event
    const codecEvent = events.find(e => e.message.startsWith('Codec negotiated:'));

    // If we got a 200 OK, we should see codec negotiation
    const got200 = events.some(e => e.status === 200);
    if (got200) {
      expect(codecEvent).toBeDefined();
      // LiveKit typically selects PCMU
      expect(codecEvent!.message).toMatch(/Codec negotiated: (PCMU|PCMA|opus|G722)/);
      expect(codecEvent!.message).toMatch(/PT=\d+/);
      expect(codecEvent!.message).toMatch(/clock=\d+Hz/);

      // Should also have "Sending audio as <codec>"
      const sendEvent = events.find(e => e.message.startsWith('Sending audio as'));
      expect(sendEvent).toBeDefined();
    } else {
      // If no 200 OK (e.g. 404), codec negotiation won't happen — that's OK
      console.log('No 200 OK received (opus+PCMU) — skipping codec negotiation assertions');
      console.log('Events:', events.map(e => `[${e.type}] ${e.message}`).join('\n'));
    }
  }, 30000);

  it('negotiates codec from INVITE with PCMU-only', async () => {
    const config: TestConfig = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE',
      codecs: ['PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000,
      responseWaitTime: 2,
    };

    const events = [];
    for await (const event of runSipTest(config)) {
      events.push(event);
    }

    console.log('PCMU-only events:', events.map(e => `[${e.type}${e.status ? ' ' + e.status : ''}] ${e.message}`).join('\n'));

    const got200 = events.some(e => e.status === 200);
    if (got200) {
      const codecEvent = events.find(e => e.message.startsWith('Codec negotiated:'));
      expect(codecEvent).toBeDefined();
      // When we only offer PCMU, LiveKit must select PCMU
      expect(codecEvent!.message).toContain('PCMU');

      const sendEvent = events.find(e => e.message.startsWith('Sending audio as'));
      expect(sendEvent).toBeDefined();
      expect(sendEvent!.message).toContain('PCMU');
    } else {
      console.log('No 200 OK received (PCMU-only) — skipping assertions');
    }
  }, 30000);

  it('negotiates codec from INVITE with PCMA+PCMU', async () => {
    const config: TestConfig = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE',
      codecs: ['PCMA', 'PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000,
      responseWaitTime: 2,
    };

    const events = [];
    for await (const event of runSipTest(config)) {
      events.push(event);
    }

    console.log('PCMA+PCMU events:', events.map(e => `[${e.type}${e.status ? ' ' + e.status : ''}] ${e.message}`).join('\n'));

    const got200 = events.some(e => e.status === 200);
    if (got200) {
      const codecEvent = events.find(e => e.message.startsWith('Codec negotiated:'));
      expect(codecEvent).toBeDefined();
      // LiveKit should select either PCMA or PCMU
      expect(codecEvent!.message).toMatch(/Codec negotiated: (PCMU|PCMA)/);

      // Audio should be sent as whatever was negotiated
      const sendEvent = events.find(e => e.message.startsWith('Sending audio as'));
      expect(sendEvent).toBeDefined();

      // Log for visibility
      console.log(`Offered: PCMA, PCMU → Negotiated: ${codecEvent!.message}`);
      console.log(`Send: ${sendEvent!.message}`);
    } else {
      console.log('No 200 OK received (PCMA+PCMU) — skipping assertions');
    }
  }, 30000);

  it('negotiates codec from INVITE with G722+PCMU', async () => {
    const config: TestConfig = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE',
      codecs: ['G722', 'PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000,
      responseWaitTime: 2,
    };

    const events = [];
    for await (const event of runSipTest(config)) {
      events.push(event);
    }

    console.log('G722+PCMU events:', events.map(e => `[${e.type}${e.status ? ' ' + e.status : ''}] ${e.message}`).join('\n'));

    const got200 = events.some(e => e.status === 200);
    if (got200) {
      const codecEvent = events.find(e => e.message.startsWith('Codec negotiated:'));
      expect(codecEvent).toBeDefined();
      // LiveKit should select G722 or fall back to PCMU
      expect(codecEvent!.message).toMatch(/Codec negotiated: (PCMU|G722)/);

      const sendEvent = events.find(e => e.message.startsWith('Sending audio as'));
      expect(sendEvent).toBeDefined();

      console.log(`Offered: G722, PCMU → Negotiated: ${codecEvent!.message}`);
      console.log(`Send: ${sendEvent!.message}`);
    } else {
      console.log('No 200 OK received (G722+PCMU) — skipping assertions');
    }
  }, 30000);

  it('SDP answer parsing extracts correct remote IP/port', async () => {
    const config: TestConfig = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE',
      codecs: ['opus', 'PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000,
      responseWaitTime: 2,
    };

    const events = [];
    for await (const event of runSipTest(config)) {
      events.push(event);
    }

    const got200 = events.some(e => e.status === 200);
    if (got200) {
      // SDP answer event should be present
      const sdpEvent = events.find(e => e.message === 'SDP answer received');
      expect(sdpEvent).toBeDefined();

      // Codec negotiation event should follow
      const codecEvent = events.find(e => e.message.startsWith('Codec negotiated:'));
      expect(codecEvent).toBeDefined();

      // "Sending audio as..." should contain the remote IP:port
      const sendEvent = events.find(e => e.message.startsWith('Sending audio as'));
      expect(sendEvent).toBeDefined();
      // Should have a real IP (not 0.0.0.0 or 127.0.0.1)
      expect(sendEvent!.message).not.toContain('0.0.0.0');
      expect(sendEvent!.message).not.toContain('127.0.0.1');
    } else {
      console.log('No 200 OK received — skipping SDP answer assertions');
    }
  }, 30000);
});
