import { describe, it, expect } from 'vitest';
import { executeSipTest } from '../../src/sip/transport.js';
import { TuiManager } from '../../src/ui/manager.js';
import type { TestConfig } from '../../src/validation/schemas.js';

describe('End-to-End: LiveKit Full Flow', () => {
  it('completes full OPTIONS test with TUI integration', async () => {
    const config: TestConfig = {
      uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
      method: 'OPTIONS',
      codecs: ['opus', 'PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000
    };

    const tui = new TuiManager();
    const events = [];

    // Simulate TUI receiving events
    for await (const event of executeSipTest(config)) {
      events.push(event);
      tui.addEvent(event);
    }

    // Verify complete event flow
    expect(events.length).toBeGreaterThanOrEqual(4);

    // 1. Network resolution
    const resolveEvent = events.find(e => e.type === 'network' && e.message.includes('Resolving'));
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent!.message).toContain('5eezfwavhxe.sip.livekit.cloud');

    // 2. Socket binding
    const bindEvent = events.find(e => e.type === 'network' && e.message.includes('Bound'));
    expect(bindEvent).toBeDefined();

    // 3. SIP request sent
    const sendEvent = events.find(e => e.type === 'sip' && e.message.includes('Sending'));
    expect(sendEvent).toBeDefined();
    expect(sendEvent!.method).toBe('OPTIONS');
    expect(sendEvent!.sdpOffer).toBeDefined();
    expect(sendEvent!.sdpOffer).toContain('v=0');
    expect(sendEvent!.sdpOffer).toContain('opus');

    // 4. SIP response received
    const responseEvent = events.find(e => e.type === 'sip' && e.status);
    expect(responseEvent).toBeDefined();
    expect(responseEvent!.status).toBe(200);
    expect(responseEvent!.message).toContain('OK');

    // Verify TUI state
    expect(tui.currentView).toBe('timeline');
  }, 15000);

  it('completes full INVITE test with SDP negotiation', async () => {
    const config: TestConfig = {
      uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
      method: 'INVITE',
      codecs: ['opus', 'PCMU', 'PCMA'],
      transport: 'udp',
      mediaPort: 12000,
      timeout: 15000
    };

    const tui = new TuiManager();
    const events = [];

    for await (const event of executeSipTest(config)) {
      events.push(event);
      tui.addEvent(event);
    }

    // Verify SDP offer
    const offerEvent = events.find(e => e.sdpOffer);
    expect(offerEvent).toBeDefined();
    
    const offer = offerEvent!.sdpOffer!;
    expect(offer).toContain('v=0');
    expect(offer).toContain('m=audio 12000');
    expect(offer).toContain('opus');
    expect(offer).toContain('PCMU');
    expect(offer).toContain('PCMA');
    expect(offer).toContain('a=rtpmap:111 opus/48000/2');
    expect(offer).toContain('a=rtpmap:0 PCMU/8000');
    expect(offer).toContain('a=rtpmap:8 PCMA/8000');

    // Verify response
    const responseEvent = events.find(e => e.status);
    expect(responseEvent).toBeDefined();
    expect([100, 200]).toContain(responseEvent!.status);

    // Verify TUI can switch views
    tui.switchView('sdp');
    expect(tui.currentView).toBe('sdp');
  }, 20000);

  it('handles multiple sequential tests', async () => {
    const tui = new TuiManager();
    
    // Test 1: OPTIONS
    const config1: TestConfig = {
      uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
      method: 'OPTIONS',
      codecs: ['opus'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000
    };

    for await (const event of executeSipTest(config1)) {
      tui.addEvent(event);
    }

    // Test 2: INVITE
    const config2: TestConfig = {
      uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
      method: 'INVITE',
      codecs: ['PCMU'],
      transport: 'udp',
      mediaPort: 11000,
      timeout: 15000
    };

    for await (const event of executeSipTest(config2)) {
      tui.addEvent(event);
    }

    // TUI should have events from both tests
    // Buffer maintains last 1000 events
  }, 30000);

  it('validates complete SIP message structure', async () => {
    const config: TestConfig = {
      uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
      method: 'OPTIONS',
      codecs: ['opus'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000
    };

    const events = [];
    for await (const event of executeSipTest(config)) {
      events.push(event);
      
      // Validate each event structure
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('message');
      expect(typeof event.timestamp).toBe('number');
      expect(typeof event.message).toBe('string');
      expect(['sip', 'rtp', 'network', 'diagnostic', 'info', 'error']).toContain(event.type);
    }

    expect(events.length).toBeGreaterThan(0);
  }, 15000);
});
