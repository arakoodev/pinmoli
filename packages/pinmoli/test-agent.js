#!/usr/bin/env node

/**
 * Test agent with LiveKit endpoint
 */

import { createPinmoliAgent } from './dist/agent/runtime.js';

async function main() {
  console.log('🎙️  Testing Pinmoli Agent with LiveKit\n');
  
  const agent = createPinmoliAgent();
  
  console.log('Agent tools:', agent.state.tools.map(t => t.name));
  console.log('System prompt length:', agent.state.systemPrompt.length);
  console.log();
  
  // Subscribe to events
  const events = [];
  agent.subscribe((event) => {
    console.log('Event:', event.type, event.type === 'message_end' ? JSON.stringify(event.message).substring(0, 100) : '');
    
    if (event.type === 'tool_execution_start') {
      console.log('  Tool:', event.toolName, 'Args:', JSON.stringify(event.args));
    }
    
    if (event.type === 'tool_execution_end' && event.result?.details?.events) {
      events.push(...event.result.details.events);
    }
  });

  // Send test query
  const query = 'Test sip:5eezfwavhxe.sip.livekit.cloud with OPTIONS';
  
  console.log('Query:', query);
  console.log('\nSending prompt...\n');
  
  try {
    await agent.prompt(query);
    console.log('\nWaiting for idle...\n');
    await agent.waitForIdle();
  } catch (error) {
    console.error('Error:', error);
  }
  
  console.log('\n=== SIP Events ===');
  for (const event of events) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const status = event.status ? ` [${event.status}]` : '';
    console.log(`[${time}] ${event.type}: ${event.message}${status}`);
  }
  
  console.log('\n✅ Agent test complete');
}

main().catch(console.error);
