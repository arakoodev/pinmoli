import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';

/**
 * UI Interaction Pattern Tests
 * Tests common user interaction patterns and edge cases
 */

describe('UI Interaction Patterns', () => {
  let tui: PinmoliTUI;
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' '));
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      output.push(chunk.toString());
      return true;
    });
    tui = new PinmoliTUI();
  });

  describe('Quick Test Pattern', () => {
    it('handles simple OPTIONS test', () => {
      tui.start();
      tui.addMessage('user', 'Test sip:example.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] 200 OK');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Server is responding');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Test sip:example.com');
      expect(fullOutput).toContain('200 OK');
      expect(fullOutput).toContain('Server is responding');
    });

    it('handles quick INVITE test', () => {
      tui.start();
      tui.addMessage('user', 'INVITE sip:user@server.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] Sending INVITE');
      tui.streamMessage('\n  [SIP] 180 Ringing');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Call setup successful');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('INVITE');
      expect(fullOutput).toContain('180 Ringing');
    });
  });

  describe('Detailed Test Pattern', () => {
    it('shows verbose output for detailed test', () => {
      tui.start();
      tui.addMessage('user', 'Test sip:server.com with full details');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP OPTIONS test to sip:server.com');
      tui.streamMessage('\n  [INFO] Resolved: server.com:5060 (192.168.1.1)');
      tui.streamMessage('\n  [INFO] UDP socket created on port 5060');
      tui.streamMessage('\n  [SIP] Sending OPTIONS request...');
      tui.streamMessage('\n  [SIP] Call-ID: abc123@localhost');
      tui.streamMessage('\n  [SIP] Waiting for response (timeout: 5000ms)');
      tui.streamMessage('\n  [SIP] Received response: 200 OK');
      tui.streamMessage('\n  [SIP] Server: Asterisk PBX 18.0.0');
      tui.streamMessage('\n  [SIP] Allow: INVITE, ACK, CANCEL, OPTIONS, BYE');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test completed. Server is Asterisk 18.0.0');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Resolved');
      expect(fullOutput).toContain('Call-ID');
      expect(fullOutput).toContain('Asterisk');
      expect(fullOutput).toContain('Allow:');
    });
  });

  describe('Comparison Pattern', () => {
    it('handles comparing multiple servers', () => {
      tui.start();
      
      // Test server 1
      tui.addMessage('user', 'Test sip:server1.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] 200 OK - 45ms');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Server1: OK (45ms)');
      
      // Test server 2
      tui.addMessage('user', 'Test sip:server2.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] 200 OK - 120ms');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Server2: OK (120ms)');
      
      // Compare
      tui.addMessage('user', 'Which is faster?');
      tui.addMessage('assistant', 'Server1 is faster (45ms vs 120ms)');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('server1.com');
      expect(fullOutput).toContain('server2.com');
      expect(fullOutput).toContain('45ms');
      expect(fullOutput).toContain('120ms');
      expect(fullOutput).toContain('faster');
    });
  });

  describe('Troubleshooting Pattern', () => {
    it('handles diagnostic workflow', () => {
      tui.start();
      
      // Initial test fails
      tui.addMessage('user', 'Test sip:broken.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [ERROR] 503 Service Unavailable');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test failed with 503');
      
      // User asks for analysis
      tui.addMessage('user', 'Why did it fail?');
      tui.streamMessage('\n[Tool] Executing analyze_failure...');
      tui.streamMessage('\n  Analyzing error code 503');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', '503 means server is overloaded or in maintenance');
      
      // User asks for suggestions
      tui.addMessage('user', 'What should I do?');
      tui.addMessage('assistant', 'Try again later or contact server admin');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('503');
      expect(fullOutput).toContain('Why did it fail');
      expect(fullOutput).toContain('overloaded');
      expect(fullOutput).toContain('What should I do');
    });

    it('handles timeout troubleshooting', () => {
      tui.start();
      
      tui.addMessage('user', 'Test sip:slow.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Waiting for response');
      tui.streamMessage('\n  [ERROR] Timeout after 5000ms');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Request timed out');
      
      tui.addMessage('user', 'Can you increase the timeout?');
      tui.addMessage('assistant', 'Yes, I can test with a longer timeout');
      
      tui.addMessage('user', 'Try with 10 seconds');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Using timeout: 10000ms');
      tui.streamMessage('\n  [SIP] 200 OK');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Success with 10s timeout');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Timeout');
      expect(fullOutput).toContain('increase the timeout');
      expect(fullOutput).toContain('10000ms');
      expect(fullOutput).toContain('Success');
    });
  });

  describe('Batch Testing Pattern', () => {
    it('handles testing multiple URIs', () => {
      tui.start();
      
      tui.addMessage('user', 'Test these servers: sip:s1.com, sip:s2.com, sip:s3.com');
      tui.addMessage('assistant', 'Testing 3 servers...');
      
      // Server 1
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] s1.com: 200 OK');
      tui.streamMessage('\n[Tool] Complete\n');
      
      // Server 2
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] s2.com: 200 OK');
      tui.streamMessage('\n[Tool] Complete\n');
      
      // Server 3
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] s3.com: 503 Unavailable');
      tui.streamMessage('\n[Tool] Complete\n');
      
      tui.addMessage('assistant', 'Results: 2/3 servers responding');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('s1.com');
      expect(fullOutput).toContain('s2.com');
      expect(fullOutput).toContain('s3.com');
      expect(fullOutput).toContain('2/3 servers');
    });
  });

  describe('Save/Load Pattern', () => {
    it('handles save and reuse workflow', () => {
      tui.start();
      
      // Run test
      tui.addMessage('user', 'Test sip:prod.com with INVITE and opus codec');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] Test complete');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test completed');
      
      // Save
      tui.addMessage('user', 'Save as "prod-invite-test"');
      tui.streamMessage('\n[Tool] Executing save_test...');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Saved');
      
      // Later: Load
      tui.addMessage('user', 'Load prod-invite-test');
      tui.streamMessage('\n[Tool] Executing load_test...');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Loaded configuration');
      
      // Run again
      tui.addMessage('user', 'Run it');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] Running saved test');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Test completed');

      const fullOutput = output.join('');
      expect(fullOutput).toContain('Save as');
      expect(fullOutput).toContain('Saved');
      expect(fullOutput).toContain('Load prod-invite-test');
      expect(fullOutput).toContain('Loaded configuration');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty messages gracefully', () => {
      tui.addMessage('user', '');
      const fullOutput = output.join('');
      expect(fullOutput).toContain('You:');
    });

    it('handles very long messages', () => {
      const longMessage = 'Test '.repeat(100);
      tui.addMessage('user', longMessage);
      const fullOutput = output.join('');
      expect(fullOutput).toContain('Test');
    });

    it('handles rapid message updates', () => {
      for (let i = 0; i < 10; i++) {
        tui.streamMessage(`[${i}] `);
      }
      const fullOutput = output.join('');
      expect(fullOutput).toContain('[0]');
      expect(fullOutput).toContain('[9]');
    });

    it('handles mixed message types', () => {
      tui.addMessage('user', 'Test');
      tui.addMessage('assistant', 'Running');
      tui.addMessage('system', 'Info');
      tui.streamMessage('[Stream]');
      
      const fullOutput = output.join('');
      expect(fullOutput).toContain('You:');
      expect(fullOutput).toContain('Pinmoli:');
      expect(fullOutput).toContain('[Stream]');
    });
  });
});
