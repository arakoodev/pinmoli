import { describe, it, expect } from 'vitest';
import { runSipTest } from '../../src/sip/engine.js';
import type { TestConfig, SipEvent } from '../../src/validation/schemas.js';

/** Collect all events from a SIP test run */
async function collectEvents(config: TestConfig): Promise<SipEvent[]> {
  const events: SipEvent[] = [];
  for await (const event of runSipTest(config)) {
    events.push(event);
  }
  return events;
}

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

describe('SIP Engine — unanswered INVITE handling', () => {
  it('OPTIONS timeout yields error, not "successfully"', async () => {
    // OPTIONS to unreachable host — should timeout and yield error
    const events = await collectEvents({
      uri: 'sip:test@192.0.2.1',  // TEST-NET: guaranteed unreachable
      method: 'OPTIONS',
      codecs: ['PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 1000
    });

    // Must have error event, not success
    const finalEvent = events[events.length - 1];
    expect(finalEvent.type).toBe('error');
    expect(finalEvent.message).not.toContain('successfully');
  });

  it('never says "successfully" when no 200 OK received', async () => {
    // INVITE to unreachable host — will timeout
    const events = await collectEvents({
      uri: 'sip:test@192.0.2.1',
      method: 'INVITE',
      codecs: ['PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 1000
    });

    // No event should contain "successfully"
    const successEvents = events.filter(e => e.message.includes('successfully'));
    expect(successEvents).toHaveLength(0);

    // Last event must be error type
    const finalEvent = events[events.length - 1];
    expect(finalEvent.type).toBe('error');
  });

  it('final event is error with code when request times out', async () => {
    const events = await collectEvents({
      uri: 'sip:test@192.0.2.1',
      method: 'INVITE',
      codecs: ['PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 1000
    });

    const finalEvent = events[events.length - 1];
    expect(finalEvent.type).toBe('error');
    // Zero responses → "Request timeout" (thrown), provisional only → "Test failed" (yielded)
    expect(finalEvent.message).toMatch(/timeout|failed/i);
    expect(finalEvent.code).toBeDefined();
  });
});
