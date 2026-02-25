import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { registerTool, isToolAllowed, ALLOWED_TOOLS } from '../../src/tools/registry.js';
import type { AgentTool } from '@mariozechner/pi-agent-core';

describe('Tool Registry', () => {
  describe('isToolAllowed', () => {
    it('allows SIP and WebRTC tools', () => {
      expect(isToolAllowed('sip_test')).toBe(true);
      expect(isToolAllowed('webrtc_test')).toBe(true);
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
    it('contains exactly 7 tools', () => {
      expect(ALLOWED_TOOLS).toHaveLength(7);
      expect(ALLOWED_TOOLS).toEqual([
        'sip_test',
        'webrtc_test',
        'analyze_failure',
        'save_test',
        'load_test',
        'list_tests',
        'generate_audio'
      ]);
    });
  });
});
