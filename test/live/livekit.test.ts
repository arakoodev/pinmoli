import { describe, it, expect, beforeEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';
import { TestTerminal } from '../../src/ui/test-terminal.js';
import { runSipTest } from '../../src/sip/engine.js';
import type { TestConfig } from '../../src/validation/schemas.js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

/**
 * Live tests against LiveKit SIP endpoint
 * Tests real SIP interactions with actual server
 */

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../.env') });

const LIVEKIT_ENDPOINT = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';

describe('LiveKit SIP Integration', () => {
  let tui: PinmoliTUI;
  let terminal: TestTerminal;

  beforeEach(() => {
    terminal = new TestTerminal();
    tui = new PinmoliTUI(terminal);
  });

  describe('OPTIONS Test Flow', () => {
    it('tests LiveKit endpoint with OPTIONS', async () => {
      tui.start();
      tui.addMessage('user', `Test ${LIVEKIT_ENDPOINT} with OPTIONS`);

      const config: TestConfig = {
        uri: LIVEKIT_ENDPOINT,
        method: 'OPTIONS',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000
      };

      tui.streamMessage('\n[Tool] Executing sip_test...');

      const events = [];
      for await (const event of runSipTest(config)) {
        events.push(event);
        tui.streamMessage(`\n  [${event.type.toUpperCase()}] ${event.message}`);

        if (event.status) {
          tui.streamMessage(` (${event.status})`);
        }
      }

      tui.streamMessage('\n[Tool] Complete\n');

      // Verify we got events
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('info');

      // Check output
      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('livekit.cloud');
      expect(fullOutput).toContain('OPTIONS');

      // Should have either success or error
      const hasResult = events.some(e => e.type === 'sip' || e.type === 'error');
      expect(hasResult).toBe(true);
    }, 10000);

    it('displays real-time progress for OPTIONS test', async () => {
      tui.start();
      tui.addMessage('user', 'Test LiveKit OPTIONS');

      const config: TestConfig = {
        uri: LIVEKIT_ENDPOINT,
        method: 'OPTIONS',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000
      };

      tui.streamMessage('\n[Tool] Executing sip_test...');

      let eventCount = 0;
      for await (const event of runSipTest(config)) {
        eventCount++;
        tui.streamMessage(`\n  [${event.type.toUpperCase()}] ${event.message}`);
      }

      tui.streamMessage('\n[Tool] Complete\n');

      // Should have multiple events showing progress
      expect(eventCount).toBeGreaterThan(1);

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('[INFO]');
      expect(fullOutput).toContain('Starting');
    }, 10000);
  });

  describe('INVITE Test Flow', () => {
    it('tests LiveKit endpoint with INVITE', async () => {
      tui.start();
      tui.addMessage('user', `Test ${LIVEKIT_ENDPOINT} with INVITE and opus`);

      const config: TestConfig = {
        uri: LIVEKIT_ENDPOINT,
        method: 'INVITE',
        codecs: ['opus', 'PCMU'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000,
        responseWaitTime: 1
      };

      tui.streamMessage('\n[Tool] Executing sip_test...');

      const events = [];
      for await (const event of runSipTest(config)) {
        events.push(event);
        tui.streamMessage(`\n  [${event.type.toUpperCase()}] ${event.message}`);
      }

      tui.streamMessage('\n[Tool] Complete\n');

      expect(events.length).toBeGreaterThan(0);

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('INVITE');
      expect(fullOutput).toContain('opus');
    }, 10000);
  });

  describe('Error Handling Flow', () => {
    it('handles timeout gracefully in UI', async () => {
      tui.start();
      tui.addMessage('user', 'Test with short timeout');

      const config: TestConfig = {
        uri: LIVEKIT_ENDPOINT,
        method: 'OPTIONS',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 100 // Very short timeout
      };

      tui.streamMessage('\n[Tool] Executing sip_test...');

      const events = [];
      for await (const event of runSipTest(config)) {
        events.push(event);
        tui.streamMessage(`\n  [${event.type.toUpperCase()}] ${event.message}`);
      }

      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('Tool');

      // Should have completed (either success or timeout)
      expect(events.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Complete User Flow', () => {
    it('simulates full user interaction with LiveKit', async () => {
      // Start
      tui.start();
      expect(terminal.getFullOutput()).toContain('Pinmoli');

      // User asks to test
      tui.addMessage('user', `Test ${LIVEKIT_ENDPOINT}`);
      expect(terminal.getFullOutput()).toContain('livekit.cloud');

      // Assistant responds
      tui.addMessage('assistant', 'Running SIP OPTIONS test against LiveKit...');

      // Execute real test
      const config: TestConfig = {
        uri: LIVEKIT_ENDPOINT,
        method: 'OPTIONS',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000
      };

      tui.streamMessage('\n[Tool] Executing sip_test...');

      const events = [];
      for await (const event of runSipTest(config)) {
        events.push(event);
        const timestamp = new Date(event.timestamp).toISOString().split('T')[1].split('.')[0];
        tui.streamMessage(`\n  [${timestamp}] [${event.type.toUpperCase()}] ${event.message}`);
      }

      tui.streamMessage('\n[Tool] Complete\n');

      // Assistant summarizes
      const hasError = events.some(e => e.type === 'error');
      if (hasError) {
        tui.addMessage('assistant', 'Test completed with errors. The server may not be responding.');
      } else {
        tui.addMessage('assistant', 'Test completed successfully!');
      }

      // Verify complete flow
      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('Pinmoli');
      expect(fullOutput).toContain('livekit.cloud');
      expect(fullOutput).toContain('[Tool] Executing sip_test');
      expect(fullOutput).toContain('[Tool] Complete');
      expect(fullOutput).toContain('Test completed');

      // Should have real events
      expect(events.length).toBeGreaterThan(0);
    }, 10000);

    it('handles multiple tests in sequence', async () => {
      tui.start();

      // Test 1: OPTIONS
      tui.addMessage('user', 'Test OPTIONS');
      tui.streamMessage('\n[Tool] Executing sip_test...');

      const config1: TestConfig = {
        uri: LIVEKIT_ENDPOINT,
        method: 'OPTIONS',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 3000
      };

      for await (const event of runSipTest(config1)) {
        tui.streamMessage(`\n  [${event.type}] ${event.message}`);
      }
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'OPTIONS test done');

      // Test 2: INVITE
      tui.addMessage('user', 'Now test INVITE');
      tui.streamMessage('\n[Tool] Executing sip_test...');

      const config2: TestConfig = {
        uri: LIVEKIT_ENDPOINT,
        method: 'INVITE',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 3000
      };

      for await (const event of runSipTest(config2)) {
        tui.streamMessage(`\n  [${event.type}] ${event.message}`);
      }
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'INVITE test done');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('OPTIONS test done');
      expect(fullOutput).toContain('INVITE test done');
    }, 20000);
  });

  describe('Codec Testing Flow', () => {
    it('tests different codecs against LiveKit', async () => {
      tui.start();
      tui.addMessage('user', 'Test LiveKit with different codecs');

      const codecs = [['opus'], ['PCMU'], ['PCMA'], ['opus', 'PCMU']];

      for (const codecList of codecs) {
        tui.addMessage('assistant', `Testing with: ${codecList.join(', ')}`);
        tui.streamMessage('\n[Tool] Executing sip_test...');

        const config: TestConfig = {
          uri: LIVEKIT_ENDPOINT,
          method: 'INVITE',
          codecs: codecList,
          transport: 'udp',
          mediaPort: 10000,
          timeout: 3000,
          responseWaitTime: 1
        };

        for await (const event of runSipTest(config)) {
          if (event.type === 'sip' || event.type === 'error') {
            tui.streamMessage(`\n  ${event.message}`);
          }
        }
        tui.streamMessage('\n[Tool] Complete\n');
      }

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('opus');
      expect(fullOutput).toContain('PCMU');
    }, 30000);
  });
});
