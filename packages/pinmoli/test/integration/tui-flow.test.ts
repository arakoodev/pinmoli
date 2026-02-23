import { describe, it, expect, beforeEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';
import { TestTerminal } from '../../src/ui/test-terminal.js';

/**
 * Flow tests for Pinmoli TUI
 * Tests the actual user interaction flows
 */

describe('Pinmoli TUI Flow Tests', () => {
  let tui: PinmoliTUI;
  let terminal: TestTerminal;

  beforeEach(() => {
    terminal = new TestTerminal();
    tui = new PinmoliTUI(terminal);
  });

  describe('Initial Flow', () => {
    it('shows welcome message on start', () => {
      tui.start();

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('Pinmoli');
      expect(fullOutput).toContain('SIP Testing Agent');
      expect(fullOutput).toContain('SIP/WebRTC testing assistant');
    });

    it('displays header with branding', () => {
      tui.start();

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toMatch(/[┌─]+/);
      expect(fullOutput).toMatch(/[└─]+/);
    });
  });

  describe('Message Flow', () => {
    it('displays user messages with correct prefix', () => {
      tui.addMessage('user', 'Test sip:example.com');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('You:');
      expect(fullOutput).toContain('Test sip:example.com');
    });

    it('displays assistant messages with correct prefix', () => {
      tui.addMessage('assistant', 'Running SIP test...');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('Pinmoli:');
      expect(fullOutput).toContain('Running SIP test');
    });

    it('displays system messages without prefix', () => {
      tui.addMessage('system', 'Test complete');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).not.toContain('You:');
      expect(fullOutput).not.toContain('Pinmoli:');
      expect(fullOutput).toContain('Test complete');
    });

    it('handles message sequence correctly', () => {
      tui.addMessage('user', 'Test OPTIONS');
      tui.addMessage('assistant', 'Starting test');
      tui.addMessage('system', 'Complete');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('You: Test OPTIONS');
      expect(fullOutput).toContain('Pinmoli: Starting test');
      expect(fullOutput).toContain('Complete');
    });
  });

  describe('Streaming Flow', () => {
    it('streams messages in real-time', () => {
      tui.streamMessage('[INFO] Starting test');
      tui.streamMessage('[SIP] Sending OPTIONS');
      tui.streamMessage('[SIP] Received 200 OK');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('[INFO] Starting test');
      expect(fullOutput).toContain('[SIP] Sending OPTIONS');
      expect(fullOutput).toContain('[SIP] Received 200 OK');
    });

    it('streams without adding newlines between chunks', () => {
      tui.streamMessage('Part 1');
      tui.streamMessage(' Part 2');
      tui.streamMessage(' Part 3');

      expect(terminal.output.length).toBe(3);
      expect(terminal.output[0]).toBe('Part 1');
      expect(terminal.output[1]).toBe(' Part 2');
      expect(terminal.output[2]).toBe(' Part 3');
    });
  });

  describe('Input Flow', () => {
    it('prompts for user input', async () => {
      const inputPromise = tui.getUserInput();

      // Simulate user typing
      terminal.simulateInput('test input\n');

      const result = await inputPromise;
      expect(result).toBe('test input');
    });

    it('shows prompt character', async () => {
      const inputPromise = tui.getUserInput();

      terminal.simulateInput('test\n');

      await inputPromise;

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('>');
    });
  });

  describe('Complete User Flow', () => {
    it('handles full conversation flow', async () => {
      // Start TUI
      tui.start();
      expect(terminal.getFullOutput()).toContain('Pinmoli');

      // User sends message
      tui.addMessage('user', 'Test sip:example.com with OPTIONS');
      expect(terminal.getFullOutput()).toContain('You: Test sip:example.com with OPTIONS');

      // Assistant responds
      tui.addMessage('assistant', 'Running SIP OPTIONS test...');
      expect(terminal.getFullOutput()).toContain('Pinmoli: Running SIP OPTIONS test');

      // Stream tool execution
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting test');
      tui.streamMessage('\n  [SIP] Sending OPTIONS');
      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('[Tool] Executing sip_test');
      expect(fullOutput).toContain('[INFO] Starting test');
      expect(fullOutput).toContain('[SIP] Sending OPTIONS');
      expect(fullOutput).toContain('[Tool] Complete');

      // Final result
      tui.addMessage('assistant', 'Test completed successfully');
      expect(terminal.getFullOutput()).toContain('Test completed successfully');
    });

    it('handles error flow', () => {
      tui.start();
      tui.addMessage('user', 'Test invalid-uri');
      tui.addMessage('assistant', 'Running test...');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [ERROR] Invalid SIP URI');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test failed. Please check the URI format.');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('[ERROR] Invalid SIP URI');
      expect(fullOutput).toContain('Test failed');
    });

    it('handles multi-turn conversation', () => {
      tui.start();

      // Turn 1
      tui.addMessage('user', 'Test sip:server1.com');
      tui.addMessage('assistant', 'Test complete');

      // Turn 2
      tui.addMessage('user', 'Now test sip:server2.com');
      tui.addMessage('assistant', 'Running second test');

      // Turn 3
      tui.addMessage('user', 'Compare the results');
      tui.addMessage('assistant', 'Both servers responded with 200 OK');

      const fullOutput = terminal.getFullOutput();
      expect(fullOutput).toContain('server1.com');
      expect(fullOutput).toContain('server2.com');
      expect(fullOutput).toContain('Compare the results');
      expect(fullOutput).toContain('Both servers responded');
    });
  });

  describe('Clear Flow', () => {
    it('clears the screen', () => {
      tui.addMessage('user', 'Test message');
      expect(terminal.output.length).toBeGreaterThan(0);

      tui.clear();
      expect(terminal.output.length).toBe(0);
    });
  });
});
