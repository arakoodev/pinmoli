/**
 * Tool Registry - SIP-only allowlist
 * OpenClaw-style tool restrictions
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';

// Allowlist: Only these 6 tools can be registered
export const ALLOWED_TOOLS = [
  'sip_test',
  'analyze_failure',
  'save_test',
  'load_test',
  'list_tests',
  'generate_audio'
] as const;

export type AllowedToolName = typeof ALLOWED_TOOLS[number];

// Tool registry
const tools = new Map<AllowedToolName, AgentTool>();

/**
 * Register a tool (only if in allowlist)
 */
export function registerTool(tool: AgentTool): void {
  const name = tool.name as AllowedToolName;
  
  if (!ALLOWED_TOOLS.includes(name)) {
    throw new Error(`Tool "${name}" not in allowlist. Only SIP tools allowed: ${ALLOWED_TOOLS.join(', ')}`);
  }
  
  tools.set(name, tool);
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
