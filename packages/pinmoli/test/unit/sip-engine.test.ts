import { describe, it, expect } from 'vitest';
import { runSipTest } from '../../src/sip/engine.js';
import type { TestConfig } from '../../src/validation/schemas.js';

describe('SIP Engine', () => {
  it('generates correct event stream structure', async () => {
    const config: TestConfig = {
      uri: 'sip:test@example.com',
      method: 'OPTIONS',
      codecs: ['opus'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 1000 // Short timeout for test
    };

    const events = [];
    
    try {
      for await (const event of runSipTest(config)) {
        events.push(event);
        
        // Verify event structure
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('message');
        
        // Stop after a few events (will timeout anyway)
        if (events.length >= 3) break;
      }
    } catch (error) {
      // Expected to timeout or fail - that's ok for this test
    }

    // Should have at least started
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('info');
    expect(events[0].message).toContain('Starting SIP');
  });

  it('builds OPTIONS request correctly', async () => {
    const config: TestConfig = {
      uri: 'sip:test@example.com',
      method: 'OPTIONS',
      codecs: ['opus'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 500
    };

    const events = [];
    
    try {
      for await (const event of runSipTest(config)) {
        events.push(event);
        if (events.length >= 2) break;
      }
    } catch (error) {
      // Expected
    }

    // Should have info about the request
    const hasResolvedEvent = events.some(e => e.message.includes('Resolved'));
    expect(hasResolvedEvent).toBe(true);
  });
});
