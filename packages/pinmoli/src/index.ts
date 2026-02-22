#!/usr/bin/env node

import { createPinmoliAgent } from './agent/runtime.js';

// Simple agent runner - pi framework handles the TUI
async function main() {
  const agent = createPinmoliAgent();
  
  // Agent is ready - pi framework will handle interaction
  console.log('Pinmoli agent initialized with 5 SIP/WebRTC testing skills');
  
  // Keep process alive
  await new Promise(() => {});
}

main().catch(console.error);

