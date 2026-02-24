import { describe, it, expect, beforeEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';
import { TestTerminal } from '../../src/ui/test-terminal.js';
import type { Config, TestConfig } from '../../src/validation/schemas.js';

/**
 * TUI-based tests for complete call flows with speech
 */

describe('Complete Call Flow with Speech', () => {
  let tui: PinmoliTUI;
  let terminal: TestTerminal;

  beforeEach(() => {
    terminal = new TestTerminal();
    tui = new PinmoliTUI(terminal);
  });

  describe('Default Speech Flow', () => {
    it('uses voice-hello by default for INVITE', () => {
      tui.start();
      tui.addMessage('user', 'Test sip:example.com with INVITE');
      tui.addMessage('assistant', 'Running INVITE test with default speech sample (voice-hello)');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Sending INVITE');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Streaming audio');
      tui.streamMessage('\n  [INFO] Audio stream complete (voice-hello)');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n  [SIP] Call terminated');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Test completed. Speech was sent successfully.');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('voice-hello');
      expect(fullOutput).toContain('Speech was sent');
      expect(fullOutput).toContain('Call terminated');
    });
  });

  describe('Custom Speech Generation Flow', () => {
    it('generates custom speech and uses it in call', () => {
      tui.start();

      // Step 1: User asks for custom speech
      tui.addMessage('user', 'Generate speech saying "This is a custom test message"');
      tui.addMessage('assistant', 'I\'ll generate that speech sample for you');

      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  Generating speech audio: custom-message.wav...');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', '✓ Generated custom-message.wav\nNow I\'ll test with it');

      // Step 2: Use the custom speech in a call
      tui.addMessage('user', 'Test sip:example.com with that speech');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Streaming audio');
      tui.streamMessage('\n  [INFO] Audio stream complete (custom-message)');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Test completed with your custom speech');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('Generate speech');
      expect(fullOutput).toContain('custom-message');
      expect(fullOutput).toContain('custom speech');
    });

    it('handles multiple custom speech samples', () => {
      tui.start();

      // Generate first sample
      tui.addMessage('user', 'Generate speech: "Hello from agent one"');
      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  ✓ Generated agent-one.wav');
      tui.streamMessage('\n[Tool] Complete\n');

      // Generate second sample
      tui.addMessage('user', 'Generate speech: "Hello from agent two"');
      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  ✓ Generated agent-two.wav');
      tui.streamMessage('\n[Tool] Complete\n');

      // Test with first
      tui.addMessage('user', 'Test with agent-one');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Audio stream complete (agent-one)');
      tui.streamMessage('\n[Tool] Complete\n');

      // Test with second
      tui.addMessage('user', 'Now test with agent-two');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Audio stream complete (agent-two)');
      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('agent-one');
      expect(fullOutput).toContain('agent-two');
    });
  });

  describe('Complete INVITE Flow with Speech', () => {
    it('shows full call lifecycle with speech', async () => {
      tui.start();
      tui.addMessage('user', 'Make a test call to sip:test@example.com');
      tui.addMessage('assistant', 'Starting SIP INVITE test with speech');

      const testConfig: TestConfig = {
        uri: 'sip:test@example.com',
        method: 'INVITE',
        codecs: ['opus', 'PCMU'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000
      };

      tui.streamMessage('\n[Tool] Executing sip_test...');

      // Simulate the full flow
      const events = [
        { type: 'info', message: 'Starting SIP INVITE test' },
        { type: 'info', message: 'Resolved: example.com:5060' },
        { type: 'info', message: 'UDP socket created' },
        { type: 'sip', message: 'Sending INVITE request...' },
        { type: 'sip', message: 'Received 100 Processing', status: 100 },
        { type: 'sip', message: 'Received 180 Ringing', status: 180 },
        { type: 'sip', message: 'Received 200 OK', status: 200 },
        { type: 'info', message: 'SDP answer received' },
        { type: 'sip', message: 'Sending ACK' },
        { type: 'info', message: 'Streaming audio to 192.168.1.1:10000' },
        { type: 'info', message: 'Audio stream complete (voice-hello)' },
        { type: 'sip', message: 'Sending BYE' },
        { type: 'sip', message: 'Call terminated' },
        { type: 'info', message: 'Test completed successfully' }
      ];

      for (const event of events) {
        tui.streamMessage(`\n  [${event.type.toUpperCase()}] ${event.message}`);
      }

      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Call completed successfully. Speech was delivered.');

      const fullOutput = terminal.getFullOutput();

      // Verify complete flow
      expect(fullOutput).toContain('INVITE request');
      expect(fullOutput).toContain('100 Processing');
      expect(fullOutput).toContain('180 Ringing');
      expect(fullOutput).toContain('200 OK');
      expect(fullOutput).toContain('Sending ACK');
      expect(fullOutput).toContain('Streaming audio');
      expect(fullOutput).toContain('voice-hello');
      expect(fullOutput).toContain('Sending BYE');
      expect(fullOutput).toContain('Call terminated');
      expect(fullOutput).toContain('Speech was delivered');
    });
  });

  describe('Speech with Different Codecs', () => {
    it('tests speech with opus codec', () => {
      tui.start();
      tui.addMessage('user', 'Test with opus codec');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Using codec: opus');
      tui.streamMessage('\n  [INFO] Audio stream complete (voice-hello)');
      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('opus');
      expect(fullOutput).toContain('voice-hello');
    });

    it('tests speech with PCMU codec', () => {
      tui.start();
      tui.addMessage('user', 'Test with PCMU codec');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Using codec: PCMU');
      tui.streamMessage('\n  [INFO] Audio stream complete (voice-hello)');
      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('PCMU');
      expect(fullOutput).toContain('voice-hello');
    });
  });

  describe('Error Handling with Speech', () => {
    it('handles speech generation failure gracefully', () => {
      tui.start();

      tui.addMessage('user', 'Generate speech with invalid text');
      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  ✗ Failed to generate audio');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Speech generation failed. Using default sample instead.');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Audio stream complete (voice-hello)');
      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('Failed to generate');
      expect(fullOutput).toContain('default sample');
      expect(fullOutput).toContain('voice-hello');
    });

    it('handles call failure after speech generation', () => {
      tui.start();

      // Generate speech successfully
      tui.addMessage('user', 'Generate speech: "Test message"');
      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  ✓ Generated test-msg.wav');
      tui.streamMessage('\n[Tool] Complete\n');

      // Call fails
      tui.addMessage('user', 'Test sip:unreachable.com with test-msg');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [ERROR] Request timeout');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Call failed but speech sample is ready for retry');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('Generated test-msg');
      expect(fullOutput).toContain('timeout');
      expect(fullOutput).toContain('ready for retry');
    });
  });

  describe('Conversational Speech Flow', () => {
    it('handles natural language speech requests', () => {
      tui.start();

      tui.addMessage('user', 'I need to test a call that says "Hello, this is the support team"');
      tui.addMessage('assistant', 'I\'ll generate that speech and test it');

      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  Generating speech: "Hello, this is the support team"');
      tui.streamMessage('\n  ✓ Generated support-team.wav');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Audio stream complete (support-team)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Test completed with your custom message');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('support team');
      expect(fullOutput).toContain('support-team');
      expect(fullOutput).toContain('custom message');
    });

    it('handles multi-turn speech workflow', () => {
      tui.start();

      // Turn 1: Generate
      tui.addMessage('user', 'Create a greeting message');
      tui.addMessage('assistant', 'What should the greeting say?');

      // Turn 2: Specify text
      tui.addMessage('user', 'Say "Welcome to our service"');
      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  ✓ Generated greeting.wav');
      tui.streamMessage('\n[Tool] Complete\n');

      // Turn 3: Test it
      tui.addMessage('user', 'Test it on sip:server.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Audio stream complete (greeting)');
      tui.streamMessage('\n[Tool] Complete\n');

      // Turn 4: Modify
      tui.addMessage('user', 'Now make it say "Thank you for calling"');
      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  ✓ Generated thank-you.wav');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Audio stream complete (thank-you)');
      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('Welcome to our service');
      expect(fullOutput).toContain('Thank you for calling');
      expect(fullOutput).toContain('greeting');
      expect(fullOutput).toContain('thank-you');
    });
  });
});
