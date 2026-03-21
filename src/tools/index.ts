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
import { generateAudioTool } from './generate-audio.js';
import { webrtcTestTool } from './webrtc-test.js';
import { replaySessionTool } from './replay-session.js';

/**
 * Register all tools (SIP + WebRTC + replay)
 * This is the only way to register tools - no dynamic registration
 */
export function registerAllTools(): void {
  registerTool(sipTestTool);
  registerTool(webrtcTestTool);
  registerTool(analyzeFailureTool);
  registerTool(saveTestTool);
  registerTool(loadTestTool);
  registerTool(listTestsTool);
  registerTool(generateAudioTool);
  registerTool(replaySessionTool);
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
  webrtcTestTool,
  analyzeFailureTool,
  saveTestTool,
  loadTestTool,
  listTestsTool
};
