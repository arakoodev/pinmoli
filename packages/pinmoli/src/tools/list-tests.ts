/**
 * List Tests Tool
 * Lists all saved test configurations
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

export const listTestsTool: AgentTool = {
  name: 'list_tests',
  label: 'List Tests',
  description: 'List all saved test configurations',
  parameters: Type.Object({}),
  
  async execute(toolCallId, params, signal, onUpdate) {
    // TODO: Query SQLite database
    // For now, return mock data
    
    const mockTests = [
      { name: 'livekit-prod', uri: 'sip:agent@livekit.example.com', lastRun: '2 minutes ago', status: '200 OK' },
      { name: 'twilio-trunk', uri: 'sip:+15551234567@pstn.twilio.com', lastRun: '1 hour ago', status: '200 OK' },
      { name: 'asterisk-local', uri: 'sip:1000@192.168.1.100', lastRun: 'yesterday', status: '401 Unauthorized' }
    ];
    
    const list = mockTests.map((t, i) => 
      `${i + 1}. ${t.name}\n   ${t.uri}\n   Last run: ${t.lastRun} (${t.status})`
    ).join('\n\n');
    
    return {
      content: [{
        type: 'text',
        text: `You have ${mockTests.length} saved tests:\n\n${list}`
      }],
      details: { tests: mockTests }
    };
  }
};
