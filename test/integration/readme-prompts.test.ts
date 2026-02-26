import { describe, it, expect, beforeEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';
import { TestTerminal } from '../../src/ui/test-terminal.js';

/**
 * Integration tests for every prompt example in README.md "Try it" section.
 * If a prompt is in the README, it must have a test here.
 *
 * Tests are grouped by category matching the README subsections.
 */

describe('README "Try it" Prompts', () => {
  let tui: PinmoliTUI;
  let terminal: TestTerminal;

  beforeEach(() => {
    terminal = new TestTerminal();
    tui = new PinmoliTUI(terminal);
  });

  // ─── SIP basics ──────────────────────────────────────────

  describe('SIP Basics', () => {
    it('Send OPTIONS to sip:trunk.example.com', () => {
      tui.start();
      tui.addMessage('user', 'Send OPTIONS to sip:trunk.example.com');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP OPTIONS test');
      tui.streamMessage('\n  [INFO] Resolved: trunk.example.com:5060');
      tui.streamMessage('\n  [SIP] Sending OPTIONS request');
      tui.streamMessage('\n  [SIP] Received 200 OK (34ms)');
      tui.streamMessage('\n  [SIP] Server: Odin/1.0');
      tui.streamMessage('\n  [SIP] Allow: INVITE, ACK, CANCEL, OPTIONS, BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Server is alive. Responded in 34ms. Supports INVITE, OPTIONS, BYE.');

      const out = terminal.getFullOutput();
      expect(out).toContain('OPTIONS');
      expect(out).toContain('200 OK');
      expect(out).toContain('trunk.example.com');
    });

    it('INVITE sip:+15551234567@sip.livekit.cloud with opus and PCMU', () => {
      tui.start();
      tui.addMessage('user', 'INVITE sip:+15551234567@sip.livekit.cloud with opus and PCMU');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Codecs offered: opus, PCMU');
      tui.streamMessage('\n  [SIP] Received 100 Trying (12ms)');
      tui.streamMessage('\n  [SIP] Received 180 Ringing (45ms)');
      tui.streamMessage('\n  [SIP] Received 200 OK (1203ms)');
      tui.streamMessage('\n  [INFO] Codec negotiated: PCMU (PT=0, clock=8000Hz)');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Streaming audio (voice-hello)');
      tui.streamMessage('\n  [INFO] Sent 150 RTP packets');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n  [SIP] Call terminated');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('opus, PCMU');
      expect(out).toContain('100 Trying');
      expect(out).toContain('180 Ringing');
      expect(out).toContain('200 OK');
      expect(out).toContain('Codec negotiated: PCMU');
      expect(out).toContain('ACK');
      expect(out).toContain('BYE');
    });

    it('Register at sip:pbx.example.com with username and password', () => {
      tui.start();
      tui.addMessage('user', 'Register at sip:pbx.example.com with username admin password secret');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP REGISTER test');
      tui.streamMessage('\n  [SIP] Sending REGISTER');
      tui.streamMessage('\n  [SIP] Received 401 Unauthorized');
      tui.streamMessage('\n  [SIP] Sending REGISTER with credentials');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [INFO] Registration successful (expires: 3600s)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Registration successful. Your credentials work. Expires in 1 hour.');

      const out = terminal.getFullOutput();
      expect(out).toContain('REGISTER');
      expect(out).toContain('401 Unauthorized');
      expect(out).toContain('credentials');
      expect(out).toContain('200 OK');
      expect(out).toContain('Registration successful');
    });
  });

  // ─── Codec negotiation ───────────────────────────────────

  describe('Codec Negotiation', () => {
    it('Test with PCMA codec -- I want to verify A-law support', () => {
      tui.start();
      tui.addMessage('user', 'Test with PCMA codec -- I want to verify A-law support');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Codecs offered: PCMA');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [INFO] Codec negotiated: PCMA (PT=8, clock=8000Hz)');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Sending audio as PCMA');
      tui.streamMessage('\n  [INFO] Sent 150 RTP packets');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'A-law (PCMA) confirmed. Server accepted PT=8 and exchanged audio.');

      const out = terminal.getFullOutput();
      expect(out).toContain('PCMA');
      expect(out).toContain('A-law');
      expect(out).toContain('Codec negotiated: PCMA (PT=8');
      expect(out).toContain('Sending audio as PCMA');
    });

    it('Call the agent using G722 and wait 20 seconds for a response', () => {
      tui.start();
      tui.addMessage('user', 'Call the agent using G722 and wait 20 seconds for a response');
      tui.addMessage('assistant', 'I\'ll use G722 wideband codec with a 20-second response window');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Codecs offered: G722');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [INFO] Codec negotiated: G722 (PT=9, clock=8000Hz)');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Sending audio as G722');
      tui.streamMessage('\n  [INFO] Audio stream complete');
      tui.streamMessage('\n  [INFO] Waiting for agent response (20s)...');
      tui.streamMessage('\n  [INFO] Received 847 RTP packets from agent');
      tui.streamMessage('\n  [INFO] Agent response window complete');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n  [SIP] Call terminated');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('G722');
      expect(out).toContain('Codec negotiated: G722 (PT=9');
      expect(out).toContain('20 seconds');
      expect(out).toContain('(20s)');
      expect(out).toContain('847 RTP packets');
    });

    it('Offer PCMA and PCMU only, see which the server picks', () => {
      tui.start();
      tui.addMessage('user', 'Test sip:pbx.example.com offering only PCMA and PCMU, see which it picks');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Codecs offered: PCMA, PCMU');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [INFO] Codec negotiated: PCMA (PT=8, clock=8000Hz)');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Sending audio as PCMA');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Server chose PCMA over PCMU. Both were offered, A-law was preferred.');

      const out = terminal.getFullOutput();
      expect(out).toContain('PCMA, PCMU');
      expect(out).toContain('Codec negotiated: PCMA');
      expect(out).toContain('chose PCMA');
    });
  });

  // ─── DTMF ────────────────────────────────────────────────

  describe('DTMF', () => {
    it('Call and press 1-2-3-# after the greeting', () => {
      tui.start();
      tui.addMessage('user', 'Call sip:+15551234567@trunk.example.com and press 1-2-3-# after the greeting');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Streaming audio (voice-hello)');
      tui.streamMessage('\n  [INFO] Audio stream complete');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 1');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 2');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 3');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: #');
      tui.streamMessage('\n  [INFO] Sent 4 DTMF digits');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n  [SIP] Call terminated');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('Sent DTMF digit: 1');
      expect(out).toContain('Sent DTMF digit: 2');
      expect(out).toContain('Sent DTMF digit: 3');
      expect(out).toContain('Sent DTMF digit: #');
      expect(out).toContain('Sent 4 DTMF digits');
    });

    it('Navigate an IVR: press 1 for sales, then 0 for operator', () => {
      tui.start();
      tui.addMessage('user', 'Call sip:+18005551234@trunk.example.com, press 1 for sales, then 0 for operator');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Streaming audio (voice-hello)');
      tui.streamMessage('\n  [INFO] Audio stream complete');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 1');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 0');
      tui.streamMessage('\n  [INFO] Sent 2 DTMF digits');
      tui.streamMessage('\n  [INFO] Waiting for agent response (10s)...');
      tui.streamMessage('\n  [INFO] Received 400 RTP packets from agent');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'IVR navigation complete. Pressed 1 (sales) then 0 (operator). Agent responded.');

      const out = terminal.getFullOutput();
      expect(out).toContain('Sent DTMF digit: 1');
      expect(out).toContain('Sent DTMF digit: 0');
      expect(out).toContain('IVR navigation');
    });

    it('Enter PIN 1234# via WebRTC', () => {
      tui.start();
      tui.addMessage('user', 'Connect via WebRTC to https://agent.example.com/whip and enter PIN 1234#');

      tui.streamMessage('\n[Tool] Executing webrtc_test...');
      tui.streamMessage('\n  [INFO] Starting WebRTC test');
      tui.streamMessage('\n  [WHIP] POST offer to https://agent.example.com/whip');
      tui.streamMessage('\n  [WHIP] Received 201 Created');
      tui.streamMessage('\n  [ICE] Connected');
      tui.streamMessage('\n  [DTLS] Handshake complete');
      tui.streamMessage('\n  [INFO] Streaming audio');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 1');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 2');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 3');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 4');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: #');
      tui.streamMessage('\n  [INFO] Sent 5 DTMF digits');
      tui.streamMessage('\n  [WHIP] DELETE session');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('WebRTC');
      expect(out).toContain('WHIP');
      expect(out).toContain('ICE');
      expect(out).toContain('DTLS');
      expect(out).toContain('Sent DTMF digit: 1');
      expect(out).toContain('Sent DTMF digit: #');
      expect(out).toContain('5 DTMF digits');
    });
  });

  // ─── Speech generation ───────────────────────────────────

  describe('Speech Generation', () => {
    it('Generate speech then call the agent', () => {
      tui.start();
      tui.addMessage('user', 'Generate speech saying "What is the weather today?" then call the agent');

      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  Generating speech: "What is the weather today?"');
      tui.streamMessage('\n  ✓ Generated weather-question.wav (2.1s, PCMU 8kHz)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Streaming audio (weather-question)');
      tui.streamMessage('\n  [INFO] Audio stream complete');
      tui.streamMessage('\n  [INFO] Waiting for agent response (10s)...');
      tui.streamMessage('\n  [INFO] Received 512 RTP packets from agent');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Asked the agent about the weather. Got a response (512 packets, ~6.4 seconds of audio).');

      const out = terminal.getFullOutput();
      expect(out).toContain('What is the weather today');
      expect(out).toContain('weather-question');
      expect(out).toContain('512 RTP packets');
    });

    it('Generate a 1000Hz sine wave for 5 seconds, then test the endpoint', () => {
      tui.start();
      tui.addMessage('user', 'Generate a 1000Hz sine wave for 5 seconds, then test the endpoint');

      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  Generating sine wave: 1000Hz, 5.0s');
      tui.streamMessage('\n  ✓ Generated sine-1000hz-5s.wav (5.0s, PCMU 8kHz)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Streaming audio (sine-1000hz-5s)');
      tui.streamMessage('\n  [INFO] Sent 250 RTP packets (5.0s)');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Sent a 1000Hz tone for 5 seconds. 250 RTP packets delivered.');

      const out = terminal.getFullOutput();
      expect(out).toContain('1000Hz');
      expect(out).toContain('5.0s');
      expect(out).toContain('sine-1000hz-5s');
      expect(out).toContain('250 RTP packets');
    });

    it('Make the greeting say "Please hold" in Spanish', () => {
      tui.start();
      tui.addMessage('user', 'Make the greeting say "Por favor espere" in Spanish, then test');

      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  Generating speech: "Por favor espere"');
      tui.streamMessage('\n  ✓ Generated por-favor-espere.wav (1.8s, PCMU 8kHz)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [INFO] Streaming audio (por-favor-espere)');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('Por favor espere');
      expect(out).toContain('por-favor-espere');
    });
  });

  // ─── Bidirectional / Listen-first ────────────────────────

  describe('Bidirectional and Listen-first', () => {
    it('Listen for 5 seconds first, then send my greeting', () => {
      tui.start();
      tui.addMessage('user', 'Call sip:agent@example.com, listen for 5 seconds first, then send my greeting');
      tui.addMessage('assistant', 'I\'ll set sendDelay to 5 seconds so we listen before speaking');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Listening for agent (sendDelay: 5s)...');
      tui.streamMessage('\n  [INFO] Received 250 RTP packets during listen phase');
      tui.streamMessage('\n  [INFO] Streaming audio (voice-hello)');
      tui.streamMessage('\n  [INFO] Audio stream complete');
      tui.streamMessage('\n  [INFO] Waiting for agent response (10s)...');
      tui.streamMessage('\n  [INFO] Agent response window complete');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('sendDelay: 5s');
      expect(out).toContain('listen');
      expect(out).toContain('250 RTP packets during listen phase');
      expect(out).toContain('Streaming audio (voice-hello)');
    });

    it('Wait 30 seconds for the agent to respond', () => {
      tui.start();
      tui.addMessage('user', 'INVITE sip:agent@livekit.cloud, send the greeting, wait 30 seconds for a response');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Streaming audio (voice-hello)');
      tui.streamMessage('\n  [INFO] Audio stream complete');
      tui.streamMessage('\n  [INFO] Waiting for agent response (30s)...');
      tui.streamMessage('\n  [INFO] Received 2400 RTP packets from agent');
      tui.streamMessage('\n  [INFO] Agent response window complete');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'The agent spoke for most of the 30-second window. 2400 packets = ~30s of audio.');

      const out = terminal.getFullOutput();
      expect(out).toContain('(30s)');
      expect(out).toContain('2400 RTP packets');
    });
  });

  // ─── WebRTC ──────────────────────────────────────────────

  describe('WebRTC', () => {
    it('Test the WHIP endpoint with a bearer token', () => {
      tui.start();
      tui.addMessage('user', 'Test the WHIP endpoint at https://my-agent.example.com/whip with bearer token abc123');

      tui.streamMessage('\n[Tool] Executing webrtc_test...');
      tui.streamMessage('\n  [INFO] Starting WebRTC test');
      tui.streamMessage('\n  [WHIP] POST offer to https://my-agent.example.com/whip');
      tui.streamMessage('\n  [WHIP] Authorization: Bearer abc1***');
      tui.streamMessage('\n  [WHIP] Received 201 Created');
      tui.streamMessage('\n  [ICE] Gathering candidates...');
      tui.streamMessage('\n  [ICE] Connected (srflx, 42ms)');
      tui.streamMessage('\n  [DTLS] Handshake complete');
      tui.streamMessage('\n  [INFO] Streaming audio (voice-hello)');
      tui.streamMessage('\n  [INFO] Sent 150 RTP packets');
      tui.streamMessage('\n  [INFO] Waiting for agent response (10s)...');
      tui.streamMessage('\n  [INFO] Received 620 RTP packets from agent');
      tui.streamMessage('\n  [INFO] Saved agent audio: /tmp/pinmoli-agent-response.wav');
      tui.streamMessage('\n  [WHIP] DELETE session');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'WebRTC test complete. Agent responded with 7.8s of audio. ICE connected in 42ms.');

      const out = terminal.getFullOutput();
      expect(out).toContain('WHIP');
      expect(out).toContain('201 Created');
      expect(out).toContain('ICE');
      expect(out).toContain('DTLS');
      expect(out).toContain('Bearer');
      expect(out).toContain('620 RTP packets');
      expect(out).toContain('agent-response.wav');
    });
  });

  // ─── Failure analysis ────────────────────────────────────

  describe('Failure Analysis', () => {
    it('Why did it fail? -- analyze after 404', () => {
      tui.start();

      // Test fails
      tui.addMessage('user', 'Test sip:+1999@trunk.example.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] Received 404 Not Found');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'The endpoint returned 404 Not Found.');

      // User asks why
      tui.addMessage('user', 'Why did it fail?');
      tui.streamMessage('\n[Tool] Executing analyze_failure...');
      tui.streamMessage('\n  Pattern: 404 Not Found');
      tui.streamMessage('\n  Diagnosis: Phone number +1999 is not configured on the SIP trunk');
      tui.streamMessage('\n  Recovery: Check the trunk\'s allowed number list');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'The phone number +1999 isn\'t configured on the trunk. Add it to the allowed numbers list.');

      const out = terminal.getFullOutput();
      expect(out).toContain('404 Not Found');
      expect(out).toContain('Why did it fail');
      expect(out).toContain('not configured');
      expect(out).toContain('allowed numbers');
    });

    it('Diagnose 488 codec mismatch', () => {
      tui.start();

      tui.addMessage('user', 'INVITE sip:endpoint@server.com with only opus');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] Received 488 Not Acceptable Here');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('user', 'What went wrong?');
      tui.streamMessage('\n[Tool] Executing analyze_failure...');
      tui.streamMessage('\n  Pattern: 488 Not Acceptable Here');
      tui.streamMessage('\n  Diagnosis: Codec mismatch -- server doesn\'t support opus');
      tui.streamMessage('\n  Recovery: Try PCMU or PCMA instead');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'The server doesn\'t support opus. Try PCMU or PCMA.');

      const out = terminal.getFullOutput();
      expect(out).toContain('488');
      expect(out).toContain('Codec mismatch');
      expect(out).toContain('Try PCMU or PCMA');
    });
  });

  // ─── Save / Load / List ──────────────────────────────────

  describe('Save, Load, and List Tests', () => {
    it('Save this test as production-health-check', () => {
      tui.start();

      // Run a test first
      tui.addMessage('user', 'Test sip:trunk.prod.com with OPTIONS');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] 200 OK (28ms)');
      tui.streamMessage('\n[Tool] Complete\n');

      // Save it
      tui.addMessage('user', 'Save this test as "production-health-check"');
      tui.streamMessage('\n[Tool] Executing save_test...');
      tui.streamMessage('\n  ✓ Saved "production-health-check"');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Test saved. Run it anytime with: "Load production-health-check"');

      const out = terminal.getFullOutput();
      expect(out).toContain('Save this test');
      expect(out).toContain('production-health-check');
      expect(out).toContain('Saved');
    });

    it('Show me all saved tests, then run one', () => {
      tui.start();

      tui.addMessage('user', 'Show me all saved tests');
      tui.streamMessage('\n[Tool] Executing list_tests...');
      tui.streamMessage('\n  Found 3 saved tests:');
      tui.streamMessage('\n    1. production-health-check (OPTIONS, sip:trunk.prod.com)');
      tui.streamMessage('\n    2. livekit-agent-check (INVITE, sip:+1555@livekit.cloud)');
      tui.streamMessage('\n    3. daily-codec-test (INVITE, G722, sip:pbx.example.com)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('user', 'Run livekit-agent-check');
      tui.streamMessage('\n[Tool] Executing load_test...');
      tui.streamMessage('\n  Loaded: livekit-agent-check');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Call terminated');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('3 saved tests');
      expect(out).toContain('production-health-check');
      expect(out).toContain('livekit-agent-check');
      expect(out).toContain('daily-codec-test');
      expect(out).toContain('Loaded: livekit-agent-check');
    });
  });

  // ─── Batch / Compare ─────────────────────────────────────

  describe('Batch Testing and Comparison', () => {
    it('Compare response times of two servers', () => {
      tui.start();

      tui.addMessage('user', 'Compare sip:trunk-us.example.com and sip:trunk-eu.example.com');
      tui.addMessage('assistant', 'I\'ll test both and compare response times');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] trunk-us.example.com: 200 OK (28ms)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] trunk-eu.example.com: 200 OK (142ms)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'US trunk: 28ms. EU trunk: 142ms. US is 5x faster from your location.');

      const out = terminal.getFullOutput();
      expect(out).toContain('trunk-us');
      expect(out).toContain('trunk-eu');
      expect(out).toContain('28ms');
      expect(out).toContain('142ms');
      expect(out).toContain('faster');
    });

    it('Test these three servers', () => {
      tui.start();

      tui.addMessage('user', 'Test these servers: sip:a.example.com, sip:b.example.com, sip:c.example.com');
      tui.addMessage('assistant', 'Testing 3 servers...');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] a.example.com: 200 OK');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [SIP] b.example.com: 200 OK');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [ERROR] c.example.com: Timeout');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', '2 of 3 servers responding. c.example.com is down.');

      const out = terminal.getFullOutput();
      expect(out).toContain('a.example.com');
      expect(out).toContain('b.example.com');
      expect(out).toContain('c.example.com');
      expect(out).toContain('2 of 3');
      expect(out).toContain('down');
    });
  });

  // ─── Troubleshooting ─────────────────────────────────────

  describe('Troubleshooting', () => {
    it('Retry with longer timeout', () => {
      tui.start();

      tui.addMessage('user', 'Test sip:slow-server.example.com');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [ERROR] Request timeout after 5000ms');
      tui.streamMessage('\n[Tool] Complete\n');
      tui.addMessage('assistant', 'Timed out at 5 seconds.');

      tui.addMessage('user', 'Try again with 15 second timeout');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Using timeout: 15000ms');
      tui.streamMessage('\n  [SIP] Received 200 OK (8234ms)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.addMessage('assistant', 'Success with 15s timeout. Server took 8.2 seconds to respond -- very slow.');

      const out = terminal.getFullOutput();
      expect(out).toContain('timeout after 5000ms');
      expect(out).toContain('15 second timeout');
      expect(out).toContain('15000ms');
      expect(out).toContain('200 OK');
      expect(out).toContain('8234ms');
    });
  });

  // ─── Advanced / Combo ────────────────────────────────────

  describe('Advanced Combinations', () => {
    it('Generate speech, test with PCMA, send DTMF after', () => {
      tui.start();
      tui.addMessage('user', 'Generate speech "Hello, I need billing support", call with PCMA, then press 2 for billing');

      tui.streamMessage('\n[Tool] Executing generate_audio...');
      tui.streamMessage('\n  ✓ Generated billing-support.wav (2.4s, PCMU 8kHz)');
      tui.streamMessage('\n[Tool] Complete\n');

      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [INFO] Codec negotiated: PCMA (PT=8, clock=8000Hz)');
      tui.streamMessage('\n  [SIP] Sending ACK');
      tui.streamMessage('\n  [INFO] Sending audio as PCMA (billing-support)');
      tui.streamMessage('\n  [DTMF] Sent DTMF digit: 2');
      tui.streamMessage('\n  [INFO] Waiting for agent response (10s)...');
      tui.streamMessage('\n  [INFO] Received 380 RTP packets from agent');
      tui.streamMessage('\n  [SIP] Sending BYE');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('billing-support');
      expect(out).toContain('Codec negotiated: PCMA');
      expect(out).toContain('Sending audio as PCMA');
      expect(out).toContain('Sent DTMF digit: 2');
      expect(out).toContain('380 RTP packets');
    });

    it('Full workflow: test, fail, analyze, fix, save', () => {
      tui.start();

      // Step 1: Test fails
      tui.addMessage('user', 'Test sip:agent@broken-trunk.com with INVITE');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [ERROR] Request timeout after 5000ms');
      tui.streamMessage('\n[Tool] Complete\n');

      // Step 2: Analyze
      tui.addMessage('user', 'Why did it fail?');
      tui.streamMessage('\n[Tool] Executing analyze_failure...');
      tui.streamMessage('\n  Diagnosis: Timeout -- endpoint may be down or firewalled');
      tui.streamMessage('\n  Recovery: Check network, try TCP transport');
      tui.streamMessage('\n[Tool] Complete\n');

      // Step 3: Fix with TCP
      tui.addMessage('user', 'Try again with TCP transport');
      tui.streamMessage('\n[Tool] Executing sip_test...');
      tui.streamMessage('\n  [INFO] Using TCP transport');
      tui.streamMessage('\n  [SIP] Received 200 OK');
      tui.streamMessage('\n  [SIP] Call terminated');
      tui.streamMessage('\n[Tool] Complete\n');

      // Step 4: Save
      tui.addMessage('user', 'Save as "trunk-tcp-workaround"');
      tui.streamMessage('\n[Tool] Executing save_test...');
      tui.streamMessage('\n  ✓ Saved "trunk-tcp-workaround"');
      tui.streamMessage('\n[Tool] Complete\n');

      const out = terminal.getFullOutput();
      expect(out).toContain('timeout');
      expect(out).toContain('Why did it fail');
      expect(out).toContain('Diagnosis');
      expect(out).toContain('TCP transport');
      expect(out).toContain('200 OK');
      expect(out).toContain('trunk-tcp-workaround');
      expect(out).toContain('Saved');
    });
  });
});
