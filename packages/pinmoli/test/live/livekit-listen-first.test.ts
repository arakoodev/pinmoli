import { describe, it, expect, beforeEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';
import { TestTerminal } from '../../src/ui/test-terminal.js';
import { runSipTest } from '../../src/sip/engine.js';
import type { TestConfig } from '../../src/validation/schemas.js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

/**
 * Live "listen first" tests against LiveKit SIP endpoint
 * Tests the sendDelay feature: wait for agent greeting before sending audio
 */

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const LIVEKIT_ENDPOINT = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';

describe('LiveKit Listen-First Mode', () => {
  let tui: PinmoliTUI;
  let terminal: TestTerminal;

  beforeEach(() => {
    terminal = new TestTerminal();
    tui = new PinmoliTUI(terminal);
  });

  it('waits for agent greeting then sends voice-hello', async () => {
    tui.start();
    tui.addMessage('user',
      `Call ${LIVEKIT_ENDPOINT} with INVITE, wait 8 seconds for the agent to speak first, then send voice-hello and wait 15 seconds for their reply`
    );

    const config: TestConfig = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE',
      codecs: ['opus', 'PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 10000,
      sendDelay: 8,
      responseWaitTime: 15
    };

    tui.streamMessage('\n[Tool] Executing sip_test...');

    const events = [];
    for await (const event of runSipTest(config)) {
      events.push(event);
      tui.streamMessage(`\n  [${event.type.toUpperCase()}] ${event.message}`);
    }

    tui.streamMessage('\n[Tool] Complete\n');

    // Verify greeting listening phase happened
    const greetingListenEvent = events.find(e =>
      e.message.includes('Listening for agent greeting')
    );
    expect(greetingListenEvent).toBeDefined();

    // Verify send phase happened after greeting phase
    const sendEvent = events.find(e => e.message.includes('Sending audio'));
    const responseListenEvent = events.find(e =>
      e.message.includes('Listening for agent response')
    );
    expect(responseListenEvent).toBeDefined();

    // Verify timing summary includes both phases
    const summaryEvent = events.find(e =>
      e.message.includes('greeting') && e.message.includes('response')
    );
    expect(summaryEvent).toBeDefined();

    // If we got past the INVITE, the greeting phase should come before the response phase
    const greetingIdx = events.indexOf(greetingListenEvent!);
    const responseIdx = events.indexOf(responseListenEvent!);
    if (greetingIdx >= 0 && responseIdx >= 0) {
      expect(greetingIdx).toBeLessThan(responseIdx);
    }
  }, 60000);

  it('sendDelay=0 behaves like original flow', async () => {
    tui.start();
    tui.addMessage('user',
      `Send INVITE to ${LIVEKIT_ENDPOINT} with voice-hello, wait 1 second for reply`
    );

    const config: TestConfig = {
      uri: LIVEKIT_ENDPOINT,
      method: 'INVITE',
      codecs: ['opus', 'PCMU'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 5000,
      sendDelay: 0,
      responseWaitTime: 1
    };

    tui.streamMessage('\n[Tool] Executing sip_test...');

    const events = [];
    for await (const event of runSipTest(config)) {
      events.push(event);
      tui.streamMessage(`\n  [${event.type.toUpperCase()}] ${event.message}`);
    }

    tui.streamMessage('\n[Tool] Complete\n');

    // Verify NO greeting listening event appears
    const greetingListenEvent = events.find(e =>
      e.message.includes('Listening for agent greeting')
    );
    expect(greetingListenEvent).toBeUndefined();

    // Should still have the response listening phase
    const responseListenEvent = events.find(e =>
      e.message.includes('Listening for agent response')
    );
    // Only check if we got past INVITE (server might reject)
    const got200 = events.some(e => e.status === 200);
    if (got200) {
      expect(responseListenEvent).toBeDefined();
    }
  }, 10000);
});
