/**
 * Tool Index
 * Exports all SIP tools and provides registration function
 */

import { registerTool, getTools } from './registry.js';
import { sipTestTool } from './sip-test.js';
import { analyzeFailureTool } from './analyze-failure.js';
import { saveTestTool } from './save-test.js';
import { loadTestTool } from './load-test.js';
import { listTestsTool } from './list-tests.js';

/**
 * Register all SIP tools
 * This is the only way to register tools - no dynamic registration
 */
export function registerAllTools(): void {
  registerTool(sipTestTool);
  registerTool(analyzeFailureTool);
  registerTool(saveTestTool);
  registerTool(loadTestTool);
  registerTool(listTestsTool);
}

/**
 * Get all registered tools for agent
 */
export function getAllTools() {
  return getTools();
}

// Re-export individual tools for testing
export {
  sipTestTool,
  analyzeFailureTool,
  saveTestTool,
  loadTestTool,
  listTestsTool
};
