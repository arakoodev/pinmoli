#!/usr/bin/env node

/**
 * Direct tool test (bypass agent)
 */

import { sipTestHandler } from './dist/skills/sip-test.js';

async function main() {
  console.log('🎙️  Direct Tool Test\n');
  
  const config = {
    uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
    method: 'OPTIONS',
    codecs: ['opus', 'PCMU'],
    transport: 'udp',
    mediaPort: 10000,
    timeout: 10000
  };

  console.log('Config:', config);
  console.log('\n=== Events ===\n');
  
  try {
    for await (const event of sipTestHandler(config)) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const status = event.status ? ` [${event.status}]` : '';
      console.log(`[${time}] ${event.type}: ${event.message}${status}`);
    }
    console.log('\n✅ Tool test complete');
  } catch (error) {
    console.error('\n❌ Tool test failed:', error);
  }
}

main();
