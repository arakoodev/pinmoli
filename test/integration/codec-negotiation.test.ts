import { describe, it, expect, beforeEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';
import { TestTerminal } from '../../src/ui/test-terminal.js';

/**
 * TUI integration tests for codec negotiation display
 */

describe('Codec Negotiation in TUI', () => {
  let tui: PinmoliTUI;
  let terminal: TestTerminal;

  beforeEach(() => {
    terminal = new TestTerminal();
    tui = new PinmoliTUI(terminal);
  });

  it('shows codec negotiation in INVITE flow', () => {
    tui.start();
    tui.addMessage('user', 'Test sip:+15551234567@livekit.cloud with PCMA codec');

    tui.streamMessage('\n[Tool] Executing sip_test...');
    tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
    tui.streamMessage('\n  [SIP] Received 200 OK');
    tui.streamMessage('\n  [INFO] SDP answer received');
    tui.streamMessage('\n  [INFO] Codec negotiated: PCMA (PT=8, clock=8000Hz)');
    tui.streamMessage('\n  [SIP] Sending ACK');
    tui.streamMessage('\n  [INFO] Sending audio as PCMA');
    tui.streamMessage('\n  [SIP] Sending BYE');
    tui.streamMessage('\n  [SIP] Call terminated');
    tui.streamMessage('\n[Tool] Complete\n');

    const fullOutput = terminal.getFullOutput();
    expect(fullOutput).toContain('Codec negotiated: PCMA (PT=8, clock=8000Hz)');
    expect(fullOutput).toContain('Sending audio as PCMA');
  });

  it('shows G722 wideband negotiation', () => {
    tui.start();
    tui.addMessage('user', 'Call the agent using G722');

    tui.streamMessage('\n[Tool] Executing sip_test...');
    tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
    tui.streamMessage('\n  [SIP] Received 200 OK');
    tui.streamMessage('\n  [INFO] SDP answer received');
    tui.streamMessage('\n  [INFO] Codec negotiated: G722 (PT=9, clock=8000Hz)');
    tui.streamMessage('\n  [SIP] Sending ACK');
    tui.streamMessage('\n  [INFO] Sending audio as G722');
    tui.streamMessage('\n  [SIP] Sending BYE');
    tui.streamMessage('\n  [SIP] Call terminated');
    tui.streamMessage('\n[Tool] Complete\n');

    const fullOutput = terminal.getFullOutput();
    expect(fullOutput).toContain('Codec negotiated: G722 (PT=9, clock=8000Hz)');
    expect(fullOutput).toContain('Sending audio as G722');
  });

  it('shows codec in full bidirectional flow', () => {
    tui.start();
    tui.addMessage('user', 'Make an INVITE call to sip:pbx.example.com offering only PCMA and PCMU');

    tui.streamMessage('\n[Tool] Executing sip_test...');
    tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
    tui.streamMessage('\n  [SIP] Received 100 Trying');
    tui.streamMessage('\n  [SIP] Received 200 OK');
    tui.streamMessage('\n  [INFO] SDP answer received');
    tui.streamMessage('\n  [INFO] Codec negotiated: PCMA (PT=8, clock=8000Hz)');
    tui.streamMessage('\n  [SIP] Sending ACK');
    tui.streamMessage('\n  [INFO] Sending audio as PCMA (voice-hello) to 10.0.0.1:20000 from port 5060');
    tui.streamMessage('\n  [INFO] Sent 150 RTP packets');
    tui.streamMessage('\n  [INFO] Received 200 RTP packets from agent');
    tui.streamMessage('\n  [SIP] Sending BYE');
    tui.streamMessage('\n  [SIP] Call terminated');
    tui.streamMessage('\n[Tool] Complete\n');

    const fullOutput = terminal.getFullOutput();
    expect(fullOutput).toContain('100 Trying');
    expect(fullOutput).toContain('200 OK');
    expect(fullOutput).toContain('Codec negotiated: PCMA');
    expect(fullOutput).toContain('ACK');
    expect(fullOutput).toContain('Sending audio as PCMA');
    expect(fullOutput).toContain('Received 200 RTP packets');
    expect(fullOutput).toContain('BYE');
  });

  it('shows fallback when codec not accepted', () => {
    tui.start();
    tui.addMessage('user', 'Test with G722 — I want to verify wideband support');

    tui.streamMessage('\n[Tool] Executing sip_test...');
    tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
    tui.streamMessage('\n  [SIP] Received 200 OK');
    tui.streamMessage('\n  [INFO] SDP answer received');
    // Server answered with PCMU even though we offered G722
    tui.streamMessage('\n  [INFO] Codec negotiated: PCMU (PT=0, clock=8000Hz)');
    tui.streamMessage('\n  [SIP] Sending ACK');
    tui.streamMessage('\n  [INFO] Sending audio as PCMU');
    tui.streamMessage('\n  [SIP] Sending BYE');
    tui.streamMessage('\n  [SIP] Call terminated');
    tui.streamMessage('\n[Tool] Complete\n');

    tui.addMessage('assistant', 'The server selected PCMU instead of G722. Wideband not supported.');

    const fullOutput = terminal.getFullOutput();
    expect(fullOutput).toContain('Codec negotiated: PCMU');
    expect(fullOutput).not.toContain('Codec negotiated: G722');
    expect(fullOutput).toContain('Sending audio as PCMU');
  });

  it('shows codec with DTMF flow', () => {
    tui.start();
    tui.addMessage('user', 'Call sip:agent@trunk.example.com using A-law encoding and send DTMF 123');

    tui.streamMessage('\n[Tool] Executing sip_test...');
    tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
    tui.streamMessage('\n  [SIP] Received 200 OK');
    tui.streamMessage('\n  [INFO] SDP answer received');
    tui.streamMessage('\n  [INFO] Codec negotiated: PCMA (PT=8, clock=8000Hz)');
    tui.streamMessage('\n  [SIP] Sending ACK');
    tui.streamMessage('\n  [INFO] Sending audio as PCMA');
    tui.streamMessage('\n  [INFO] Sent 150 RTP packets');
    tui.streamMessage('\n  [DTMF] Sent DTMF digit: 1');
    tui.streamMessage('\n  [DTMF] Sent DTMF digit: 2');
    tui.streamMessage('\n  [DTMF] Sent DTMF digit: 3');
    tui.streamMessage('\n  [INFO] Sent 3 DTMF digits');
    tui.streamMessage('\n  [SIP] Sending BYE');
    tui.streamMessage('\n  [SIP] Call terminated');
    tui.streamMessage('\n[Tool] Complete\n');

    const fullOutput = terminal.getFullOutput();
    expect(fullOutput).toContain('Codec negotiated: PCMA');
    expect(fullOutput).toContain('Sending audio as PCMA');
    expect(fullOutput).toContain('Sent DTMF digit: 1');
    expect(fullOutput).toContain('Sent DTMF digit: 2');
    expect(fullOutput).toContain('Sent DTMF digit: 3');
  });
});
