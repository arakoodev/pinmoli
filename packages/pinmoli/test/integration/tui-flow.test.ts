import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';
import { Readable, Writable } from 'stream';

/**
 * Flow tests for Pinmoli TUI
 * Tests the actual user interaction flows
 */

describe('Pinmoli TUI Flow Tests', () => {
  let tui: PinmoliTUI;
  let mockStdin: Readable;
  let mockStdout: Writable;
  let output: string[];

  beforeEach(() => {
    // Mock stdin/stdout
    mockStdin = new Readable({ read() {} });
    mockStdout = new Writable({
      write(chunk, encoding, callback) {
        output.push(chunk.toString());
        callback();
      }
    });
    output = [];

    // Replace process streams
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true });

    // Spy on console methods
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });
    vi.spyOn(console, 'clear').mockImplementation(() => {
      output = [];
    });

    tui = new PinmoliTUI();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Flow', () => {
    it('shows welcome message on start', () => {
      tui.start();

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Pinmoli');
      expect(fullOutput).toContain('SIP Testing Agent');
      expect(fullOutput).toContain('SIP/WebRTC testing assistant');
    });

    it('displays header with branding', () => {
      tui.start();

      const fullOutput = output.join('');
      expect(fullOutput).toMatch(/[┌─]+/);
      expect(fullOutput).toMatch(/[└─]+/);
    });
  });

  describe('Message Flow', () => {
    it('displays user messages with correct prefix', () => {
      tui.addMessage('user', 'Test sip:example.com');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('You:');
      expect(fullOutput).toContain('Test sip:example.com');
    });

    it('displays assistant messages with correct prefix', () => {
      tui.addMessage('assistant', 'Running SIP test...');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Pinmoli:');
      expect(fullOutput).toContain('Running SIP test');
    });

    it('displays system messages without prefix', () => {
      tui.addMessage('system', 'Test complete');

      const fullOutput = output.join('');
      expect(fullOutput).not.toContain('You:');
      expect(fullOutput).not.toContain('Pinmoli:');
      expect(fullOutput).toContain('Test complete');
    });

    it('handles message sequence correctly', () => {
      tui.addMessage('user', 'Test OPTIONS');
      tui.addMessage('assistant', 'Starting test');
      tui.addMessage('system', 'Complete');

      const fullOutput = output.join('');
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

      const fullOutput = output.join('');
      expect(fullOutput).toContain('[INFO] Starting test');
      expect(fullOutput).toContain('[SIP] Sending OPTIONS');
      expect(fullOutput).toContain('[SIP] Received 200 OK');
    });

    it('streams without adding newlines between chunks', () => {
      output = [];
      tui.streamMessage('Part 1');
      tui.streamMessage(' Part 2');
      tui.streamMessage(' Part 3');

      expect(output.length).toBe(3);
      expect(output[0]).toBe('Part 1');
      expect(output[1]).toBe(' Part 2');
      expect(output[2]).toBe(' Part 3');
    });
  });

  describe('Input Flow', () => {
    it('prompts for user input', async () => {
      const inputPromise = tui.getUserInput();
      
      // Simulate user typing
      mockStdin.push('test input\n');
      mockStdin.push(null);

      const result = await inputPromise;
      expect(result).toBe('test input');
    });

    it('shows prompt character', async () => {
      output = [];
      const inputPromise = tui.getUserInput();
      
      mockStdin.push('test\n');
      mockStdin.push(null);
      
      await inputPromise;
      
      const fullOutput = output.join('');
      expect(fullOutput).toContain('>');
    });
  });

  describe('Complete User Flow', () => {
    it('handles full conversation flow', async () => {
      // Start TUI
      tui.start();
      expect(output.join('')).toContain('Pinmoli');

      // User sends message
      tui.addMessage('user', 'Test sip:example.com with OPTIONS');
      expect(output.join('')).toContain('You: Test sip:example.com with OPTIONS');

      // Assistant responds
      tui.addMessage('assistant', 'Running SIP OPTIONS test...');
      expect(output.join('')).toContain('Pinmoli: Running SIP OPTIONS test');

      // Stream tool execution
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting test');
      tui.streamMessage('\n  [SIP] Sending OPTIONS');
      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('[Tool] Executing sip_test');
      expect(fullOutput).toContain('[INFO] Starting test');
      expect(fullOutput).toContain('[SIP] Sending OPTIONS');
      expect(fullOutput).toContain('[Tool] Complete');

      // Final result
      tui.addMessage('assistant', 'Test completed successfully');
      expect(output.join('')).toContain('Test completed successfully');
    });

    it('handles error flow', () => {
      tui.start();
      tui.addMessage('user', 'Test invalid-uri');
      tui.addMessage('assistant', 'Running test...');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [ERROR] Invalid SIP URI');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test failed. Please check the URI format.');

      const fullOutput = output.join('');
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

      const fullOutput = output.join('');
      expect(fullOutput).toContain('server1.com');
      expect(fullOutput).toContain('server2.com');
      expect(fullOutput).toContain('Compare the results');
      expect(fullOutput).toContain('Both servers responded');
    });
  });

  describe('Clear Flow', () => {
    it('clears the screen', () => {
      tui.addMessage('user', 'Test message');
      expect(output.length).toBeGreaterThan(0);

      tui.clear();
      expect(output.length).toBe(0);
    });
  });
});
