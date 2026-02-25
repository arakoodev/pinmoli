/**
 * Load Test Tool
 * Loads saved test configurations from SQLite
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

export const loadTestTool: AgentTool = {
  name: 'load_test',
  label: 'Load Test',
  description: 'Load a saved test configuration',
  parameters: Type.Object({
    name: Type.String({ description: 'Name of the saved test' })
  }),
  
  async execute(toolCallId, params, _signal, _onUpdate) {
    const { name } = params as { name: string };
    
    // TODO: Load from SQLite database
    // For now, return mock data
    
    const mockConfig = {
      uri: 'sip:agent@example.com',
      method: 'OPTIONS',
      codecs: ['opus'],
      transport: 'udp',
      mediaPort: 10000,
      timeout: 5000
    };
    
    return {
      content: [{
        type: 'text',
        text: `Loaded test "${name}":\n${JSON.stringify(mockConfig, null, 2)}`
      }],
      details: { name, config: mockConfig }
    };
  }
};
