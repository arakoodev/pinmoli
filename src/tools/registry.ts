/**
 * Tool Registry - SIP-only allowlist
 * OpenClaw-style tool restrictions
 *
 * Tools are wrapped at registration time to auto-record calls
 * into the session manifest for replay support.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { recordToolCall } from '../network/session.js';

// Allowlist: Only these 7 tools can be registered
export const ALLOWED_TOOLS = [
  'sip_test',
  'webrtc_test',
  'analyze_failure',
  'save_test',
  'load_test',
  'list_tests',
  'generate_audio',
  'replay_session'
] as const;

export type AllowedToolName = typeof ALLOWED_TOOLS[number];

// Tool registry
const tools = new Map<AllowedToolName, AgentTool>();

/**
 * Register a tool (only if in allowlist).
 * Wraps execute() to record calls in the session manifest.
 */
export function registerTool(tool: AgentTool): void {
  const name = tool.name as AllowedToolName;

  if (!ALLOWED_TOOLS.includes(name)) {
    throw new Error(`Tool "${name}" not in allowlist. Only SIP tools allowed: ${ALLOWED_TOOLS.join(', ')}`);
  }

  // Wrap execute to record tool calls for session replay
  const originalExecute = tool.execute.bind(tool);
  const wrappedTool: AgentTool = {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      const timestamp = new Date().toISOString();
      const start = Date.now();
      let success = true;
      let testDir: string | undefined;
      try {
        const result = await originalExecute(toolCallId, params, signal, onUpdate);
        if (result.details && typeof result.details === 'object' && 'error' in result.details) {
          success = false;
        }
        // Capture testDir from sip_test/webrtc_test results for flow.json lookup
        if (result.details && typeof result.details === 'object' && 'testDir' in result.details) {
          testDir = result.details.testDir as string;
        }
        return result;
      } catch (error) {
        success = false;
        throw error;
      } finally {
        recordToolCall({
          tool: name,
          params: params as Record<string, unknown>,
          timestamp,
          durationMs: Date.now() - start,
          success,
          testDir,
        });
      }
    },
  };

  tools.set(name, wrappedTool);
}

/**
 * Get all registered tools
 */
export function getTools(): AgentTool[] {
  return Array.from(tools.values());
}

/**
 * Get a specific tool
 */
export function getTool(name: AllowedToolName): AgentTool | undefined {
  return tools.get(name);
}

/**
 * Check if a tool is allowed
 */
export function isToolAllowed(name: string): boolean {
  return ALLOWED_TOOLS.includes(name as AllowedToolName);
}
