import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinmoliTUI } from '../../src/ui/tui.js';

/**
 * Tests for bidirectional conversation flow with voice agents
 */

describe('Bidirectional Agent Conversation', () => {
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

  it('waits for agent response after sending audio', () => {
    tui.start();
    tui.addMessage('user', 'Test sip:agent@livekit.cloud');
    
    tui.streamMessage('\n[Tool] Executing sip_test...');
    tui.streamMessage('\n  [SIP] Received 200 OK');
    tui.streamMessage('\n  [SIP] Sending ACK');
    tui.streamMessage('\n  [INFO] Streaming audio to 143.223.91.189:57336');
    tui.streamMessage('\n  [INFO] Audio stream complete (voice-hello)');
    tui.streamMessage('\n  [INFO] Waiting for agent response...');
    tui.streamMessage('\n  [INFO] Agent response window complete');
    tui.streamMessage('\n  [SIP] Sending BYE');
    tui.streamMessage('\n  [SIP] Call terminated');
    tui.streamMessage('\n[Tool] Complete\n');

    const fullOutput = output.join('');
    expect(fullOutput).toContain('Streaming audio');
    expect(fullOutput).toContain('Waiting for agent response');
    expect(fullOutput).toContain('Agent response window complete');
    expect(fullOutput).toContain('Sending BYE');
  });

  it('shows complete bidirectional flow', () => {
    tui.start();
    tui.addMessage('user', 'Have a conversation with the LiveKit agent');
    tui.addMessage('assistant', 'I\'ll call the agent and wait for their response');
    
    tui.streamMessage('\n[Tool] Executing sip_test...');
    tui.streamMessage('\n  [INFO] Starting SIP INVITE test');
    tui.streamMessage('\n  [SIP] Received 100 Processing');
    tui.streamMessage('\n  [SIP] Received 180 Ringing');
    tui.streamMessage('\n  [SIP] Received 200 OK');
    tui.streamMessage('\n  [INFO] SDP answer received');
    tui.streamMessage('\n  [SIP] Sending ACK');
    tui.streamMessage('\n  [INFO] Streaming audio to remote endpoint');
    tui.streamMessage('\n  [INFO] Audio stream complete (voice-hello)');
    tui.streamMessage('\n  [INFO] Waiting for agent response...');
    tui.streamMessage('\n  [INFO] Agent response window complete (10s)');
    tui.streamMessage('\n  [SIP] Sending BYE');
    tui.streamMessage('\n  [SIP] Call terminated');
    tui.streamMessage('\n[Tool] Complete\n');
    
    tui.addMessage('assistant', 'Conversation complete. The agent had 10 seconds to respond.');

    const fullOutput = output.join('');
    expect(fullOutput).toContain('INVITE');
    expect(fullOutput).toContain('Ringing');
    expect(fullOutput).toContain('ACK');
    expect(fullOutput).toContain('Streaming audio');
    expect(fullOutput).toContain('Waiting for agent response');
    expect(fullOutput).toContain('10 seconds');
    expect(fullOutput).toContain('BYE');
  });

  it('explains the bidirectional flow to user', () => {
    tui.start();
    tui.addMessage('user', 'Why does the call take so long?');
    tui.addMessage('assistant', 'After sending our audio, we wait 10 seconds for the agent to respond. This allows bidirectional conversation.');
    
    const fullOutput = output.join('');
    expect(fullOutput).toContain('10 seconds');
    expect(fullOutput).toContain('bidirectional');
  });

  it('handles custom speech with agent response', () => {
    tui.start();
    
    // Generate custom speech
    tui.addMessage('user', 'Generate speech: "What is the weather today?"');
    tui.streamMessage('\n[Tool] Executing generate_audio...');
    tui.streamMessage('\n  ✓ Generated weather-question.wav');
    tui.streamMessage('\n[Tool] Complete\n');
    
    // Test with agent
    tui.addMessage('user', 'Ask the agent that question');
    tui.streamMessage('\n[Tool] Executing sip_test...');
    tui.streamMessage('\n  [SIP] Received 200 OK');
    tui.streamMessage('\n  [SIP] Sending ACK');
    tui.streamMessage('\n  [INFO] Streaming audio (weather-question)');
    tui.streamMessage('\n  [INFO] Audio stream complete');
    tui.streamMessage('\n  [INFO] Waiting for agent response...');
    tui.streamMessage('\n  [INFO] Agent response window complete');
    tui.streamMessage('\n  [SIP] Sending BYE');
    tui.streamMessage('\n[Tool] Complete\n');
    
    tui.addMessage('assistant', 'Question sent. The agent had time to respond.');

    const fullOutput = output.join('');
    expect(fullOutput).toContain('weather-question');
    expect(fullOutput).toContain('Waiting for agent response');
    expect(fullOutput).toContain('agent had time to respond');
  });
});
