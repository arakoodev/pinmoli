import { describe, it, expect } from 'vitest';
import { sipTestHandler } from '../../src/skills/sip-test.js';
import type { TestConfig } from '../../src/validation/schemas.js';

describe('SIP Test Handler', () => {
  it('validates config at skill boundary', async () => {
    const invalidConfig = {
      uri: 'invalid-uri',
      method: 'OPTIONS',
      codecs: [],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 5000
    } as unknown as TestConfig;

    await expect(async () => {
      const events = [];
      for await (const event of sipTestHandler(invalidConfig)) {
        events.push(event);
      }
    }).rejects.toThrow();
  });

  it('streams events as generator', async () => {
    const config: TestConfig = {
      uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
      method: 'OPTIONS',
      codecs: ['opus'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000
    };

    const events = [];
    for await (const event of sipTestHandler(config)) {
      events.push(event);
      // Verify each event is yielded immediately
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('message');
    }

    expect(events.length).toBeGreaterThan(0);
  }, 15000);

  it('handles all SIP methods', async () => {
    const methods: Array<'OPTIONS' | 'INVITE' | 'REGISTER'> = ['OPTIONS', 'INVITE', 'REGISTER'];

    for (const method of methods) {
      const config: TestConfig = {
        uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
        method,
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 10000
      };

      const events = [];
      for await (const event of sipTestHandler(config)) {
        events.push(event);
      }

      const methodEvent = events.find(e => e.method === method);
      expect(methodEvent).toBeDefined();
    }
  }, 45000);
});
