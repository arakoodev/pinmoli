import { describe, it, expect } from 'vitest';
import { runSipTest } from '../../src/sip/engine.js';

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
      for await (const event of runSipTest(config)) {
        events.push(event);
        if (events.length > 10) break;
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
      for await (const event of runSipTest(config)) {
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
      for await (const event of runSipTest(config)) {
        events.push(event);
      }
    } catch (error) {
      // Expected
    }

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000);
  });
});
