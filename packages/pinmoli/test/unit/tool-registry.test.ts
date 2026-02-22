import { describe, it, expect, beforeEach } from 'vitest';
import { Type } from '@sinclair/typebox';
import { registerTool, getTools, isToolAllowed, ALLOWED_TOOLS } from '../../src/tools/registry.js';
import type { AgentTool } from '@mariozechner/pi-agent-core';

describe('Tool Registry', () => {
  describe('isToolAllowed', () => {
    it('allows SIP tools', () => {
      expect(isToolAllowed('sip_test')).toBe(true);
      expect(isToolAllowed('analyze_failure')).toBe(true);
      expect(isToolAllowed('save_test')).toBe(true);
      expect(isToolAllowed('load_test')).toBe(true);
      expect(isToolAllowed('list_tests')).toBe(true);
    });

    it('blocks non-SIP tools', () => {
      expect(isToolAllowed('read')).toBe(false);
      expect(isToolAllowed('write')).toBe(false);
      expect(isToolAllowed('edit')).toBe(false);
      expect(isToolAllowed('exec')).toBe(false);
      expect(isToolAllowed('bash')).toBe(false);
      expect(isToolAllowed('web_search')).toBe(false);
    });
  });

  describe('registerTool', () => {
    it('registers allowed tools', () => {
      const tool: AgentTool = {
        name: 'sip_test',
        description: 'Test SIP endpoint',
        parameters: Type.Object({}),
        async execute() {
          return { content: [] };
        }
      };

      expect(() => registerTool(tool)).not.toThrow();
    });

    it('rejects non-allowed tools', () => {
      const tool: AgentTool = {
        name: 'read',
        description: 'Read file',
        parameters: Type.Object({}),
        async execute() {
          return { content: [] };
        }
      };

      expect(() => registerTool(tool)).toThrow(/not in allowlist/);
    });

    it('rejects bash tool', () => {
      const tool: AgentTool = {
        name: 'bash',
        description: 'Execute bash',
        parameters: Type.Object({}),
        async execute() {
          return { content: [] };
        }
      };

      expect(() => registerTool(tool)).toThrow(/not in allowlist/);
    });
  });

  describe('ALLOWED_TOOLS', () => {
    it('contains exactly 5 SIP tools', () => {
      expect(ALLOWED_TOOLS).toHaveLength(5);
      expect(ALLOWED_TOOLS).toEqual([
        'sip_test',
        'analyze_failure',
        'save_test',
        'load_test',
        'list_tests'
      ]);
    });
  });
});
