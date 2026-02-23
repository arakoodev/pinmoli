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
});
