/**
 * Load Test Tool
 * Loads saved test configurations from SQLite
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { loadCollection } from '../storage/db.js';

export const loadTestTool: AgentTool = {
  name: 'load_test',
  label: 'Load Test',
  description: 'Load a saved test configuration',
  parameters: Type.Object({
    name: Type.String({ description: 'Name of the saved test' })
  }),

  async execute(toolCallId, params, _signal, _onUpdate) {
    const { name } = params as { name: string };

    const config = loadCollection(name);

    if (!config) {
      return {
        content: [{
          type: 'text',
          text: `No test found with name "${name}". Use list_tests to see available tests.`
        }],
        details: { error: 'not_found', name },
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Loaded test "${name}":\n${JSON.stringify(config, null, 2)}`
      }],
      details: { name, config }
    };
  }
};
