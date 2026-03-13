/**
 * List Tests Tool
 * Lists all saved test configurations
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { getAllCollections } from '../storage/db.js';

export const listTestsTool: AgentTool = {
  name: 'list_tests',
  label: 'List Tests',
  description: 'List all saved test configurations',
  parameters: Type.Object({}),

  async execute(_toolCallId, _params, _signal, _onUpdate) {
    const collections = getAllCollections();

    if (collections.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No saved tests. Use save_test to save a test configuration.'
        }],
        details: { tests: [] }
      };
    }

    const list = collections.map((c, i) => {
      const date = new Date(c.createdAt).toLocaleString();
      return `${i + 1}. ${c.name} (saved ${date})`;
    }).join('\n');

    return {
      content: [{
        type: 'text',
        text: `${collections.length} saved test${collections.length === 1 ? '' : 's'}:\n\n${list}`
      }],
      details: { tests: collections }
    };
  }
};
