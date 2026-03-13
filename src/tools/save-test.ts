/**
 * Save Test Tool
 * Saves test configurations to SQLite
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { TestConfigSchema, type TestConfig } from '../validation/schemas.js';
import { saveCollection } from '../storage/db.js';

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
    const { name, config } = params as { name: string; config: TestConfig };

    try {
      saveCollection(name, config);
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        return {
          content: [{
            type: 'text',
            text: `Error: A test named "${name}" already exists. Choose a different name or delete the existing one first.`
          }],
          details: { error: 'duplicate_name', name },
        };
      }
      throw err;
    }

    return {
      content: [{
        type: 'text',
        text: `Saved test "${name}" to ~/.pinmoli/pinmoli.db`
      }],
      details: { name, config }
    };
  }
};
