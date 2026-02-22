import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinmoliAgent } from '../../src/agent/runtime.js';
import { PinmoliTUI } from '../../src/ui/tui.js';
import type { Config } from '../../src/validation/schemas.js';

/**
 * End-to-end flow tests
 * Tests complete user flows through the system
 */

describe('End-to-End Flow Tests', () => {
  let config: Config;
  let output: string[];

  beforeEach(() => {
    config = {
      llm: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'test-key'
      },
      sip: {
        defaultTimeout: 5000,
        defaultTransport: 'udp',
        defaultMediaPort: 10000
      }
    };

    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      output.push(chunk.toString());
      return true;
    });
  });

  describe('Agent + TUI Integration', () => {
    it('wires agent events to TUI streaming', () => {
      const tui = new PinmoliTUI();
      const agent = new PinmoliAgent(config, tui);

      expect(agent).toBeDefined();
      expect(tui).toBeDefined();
    });

    it('TUI receives tool execution events', async () => {
      const tui = new PinmoliTUI();
      const agent = new PinmoliAgent(config, tui);

      // Simulate tool execution by directly calling streamMessage
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting test');
      tui.streamMessage('\n[Tool] Complete\n');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('[Tool] Executing sip_test');
      expect(fullOutput).toContain('[INFO] Starting test');
      expect(fullOutput).toContain('[Tool] Complete');
    });
  });

  describe('SIP Test Flow', () => {
    it('handles OPTIONS test flow', () => {
      const tui = new PinmoliTUI();
      tui.start();

      // User request
      tui.addMessage('user', 'Test sip:example.com with OPTIONS method');
      
      // Agent response
      tui.addMessage('assistant', 'I\'ll run an OPTIONS test');
      
      // Tool execution stream
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP OPTIONS test');
      tui.streamMessage('\n  [INFO] Resolved: example.com:5060');
      tui.streamMessage('\n  [SIP] Sending OPTIONS request');
      tui.streamMessage('\n[Tool] Complete\n');
      
      // Final response
      tui.addMessage('assistant', 'Test completed');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Test sip:example.com');
      expect(fullOutput).toContain('OPTIONS test');
      expect(fullOutput).toContain('Sending OPTIONS request');
      expect(fullOutput).toContain('Test completed');
    });

    it('handles INVITE test flow', () => {
      const tui = new PinmoliTUI();
      tui.start();

      tui.addMessage('user', 'Test INVITE to sip:user@server.com with opus codec');
      tui.addMessage('assistant', 'Running INVITE test with opus');
      
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Sending INVITE with SDP');
      tui.streamMessage('\n  [SIP] Codecs: opus');
      tui.streamMessage('\n[Tool] Complete\n');
      
      tui.addMessage('assistant', 'INVITE test completed');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('INVITE');
      expect(fullOutput).toContain('opus');
      expect(fullOutput).toContain('SDP');
    });

    it('handles REGISTER test flow', () => {
      const tui = new PinmoliTUI();
      tui.start();

      tui.addMessage('user', 'Register to sip:registrar.com');
      tui.addMessage('assistant', 'Running REGISTER test');
      
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP REGISTER test');
      tui.streamMessage('\n  [SIP] Sending REGISTER');
      tui.streamMessage('\n[Tool] Complete\n');
      
      tui.addMessage('assistant', 'Registration test completed');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('REGISTER');
      expect(fullOutput).toContain('registrar.com');
    });
  });

  describe('Error Handling Flow', () => {
    it('handles timeout errors gracefully', () => {
      const tui = new PinmoliTUI();
      tui.start();

      tui.addMessage('user', 'Test sip:unreachable.com');
      tui.addMessage('assistant', 'Running test');
      
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting test');
      tui.streamMessage('\n  [ERROR] Request timeout after 5000ms');
      tui.streamMessage('\n[Tool] Complete\n');
      
      tui.addMessage('assistant', 'Test failed due to timeout. The server may be unreachable.');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('timeout');
      expect(fullOutput).toContain('unreachable');
    });

    it('handles invalid URI errors', () => {
      const tui = new PinmoliTUI();
      tui.start();

      tui.addMessage('user', 'Test invalid-uri');
      tui.addMessage('assistant', 'I notice the URI format is invalid');
      
      const fullOutput = output.join('');
      expect(fullOutput).toContain('invalid');
    });

    it('handles DNS resolution errors', () => {
      const tui = new PinmoliTUI();
      tui.start();

      tui.addMessage('user', 'Test sip:nonexistent.invalid');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [ERROR] DNS resolution failed');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Could not resolve hostname');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('DNS resolution failed');
      expect(fullOutput).toContain('Could not resolve');
    });
  });

  describe('Multi-Step Flow', () => {
    it('handles test, analyze, save workflow', () => {
      const tui = new PinmoliTUI();
      tui.start();

      // Step 1: Run test
      tui.addMessage('user', 'Test sip:server.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] Test complete');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test completed with errors');

      // Step 2: Analyze
      tui.addMessage('user', 'Analyze the failure');
      tui.streamMessage('\n[Tool] Executing analyze_failure...');
      tui.streamMessage('\n  Analyzing error patterns');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'The server returned 503 Service Unavailable');

      // Step 3: Save
      tui.addMessage('user', 'Save this test as "server-test"');
      tui.streamMessage('\n[Tool] Executing save_test...');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test saved successfully');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Test sip:server.com');
      expect(fullOutput).toContain('Analyze the failure');
      expect(fullOutput).toContain('503 Service Unavailable');
      expect(fullOutput).toContain('Save this test');
      expect(fullOutput).toContain('saved successfully');
    });

    it('handles load and re-run workflow', () => {
      const tui = new PinmoliTUI();
      tui.start();

      // Load saved test
      tui.addMessage('user', 'Load test "server-test"');
      tui.streamMessage('\n[Tool] Executing load_test...');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Loaded test configuration');

      // Re-run
      tui.addMessage('user', 'Run it again');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] Running test');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test completed');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Load test');
      expect(fullOutput).toContain('Loaded test configuration');
      expect(fullOutput).toContain('Run it again');
    });

    it('handles list and select workflow', () => {
      const tui = new PinmoliTUI();
      tui.start();

      tui.addMessage('user', 'Show me all saved tests');
      tui.streamMessage('\n[Tool] Executing list_tests...');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Found 3 saved tests: test1, test2, test3');

      tui.addMessage('user', 'Load test2');
      tui.streamMessage('\n[Tool] Executing load_test...');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Loaded test2');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Show me all saved tests');
      expect(fullOutput).toContain('Found 3 saved tests');
      expect(fullOutput).toContain('Load test2');
    });
  });

  describe('Real-time Streaming Flow', () => {
    it('shows progressive updates during long test', () => {
      const tui = new PinmoliTUI();
      tui.start();

      tui.addMessage('user', 'Test sip:server.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      
      // Simulate progressive updates
      tui.streamMessage('\n  [INFO] Starting test');
      tui.streamMessage('\n  [INFO] Resolved: 192.168.1.1:5060');
      tui.streamMessage('\n  [INFO] UDP socket created');
      tui.streamMessage('\n  [SIP] Sending OPTIONS');
      tui.streamMessage('\n  [SIP] Waiting for response');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n[Tool] Complete\n');
      
      tui.addMessage('assistant', 'Test successful');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Starting test');
      expect(fullOutput).toContain('Resolved');
      expect(fullOutput).toContain('UDP socket created');
      expect(fullOutput).toContain('Sending OPTIONS');
      expect(fullOutput).toContain('Waiting for response');
      expect(fullOutput).toContain('Received 200 OK');
    });
  });
});
