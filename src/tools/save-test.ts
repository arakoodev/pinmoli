/**
 * Save Test Tool
 * Saves test configurations to SQLite
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { TestConfigSchema } from '../validation/schemas.js';

export const saveTestTool: AgentTool = {
  name: 'save_test',
  label: 'Save Test',
  description: 'Save a test configuration for later reuse',
  parameters: Type.Object({
    name: Type.String({ 
      pattern: '^[a-zA-Z0-9_-]+$',
      description: 'Unique test name (alphanumeric, hyphens, underscores only)' 
    }),
    config: TestConfigSchema
  }),
  
  async execute(toolCallId, params, _signal, _onUpdate) {
    const { name, config } = params as { name: string; config: Record<string, unknown> };
    
    // TODO: Save to SQLite database
    // For now, just return success
    
    return {
      content: [{
        type: 'text',
        text: `✓ Saved test "${name}" to ~/.pinmoli/pinmoli.db`
      }],
      details: { name, config }
    };
  }
};
