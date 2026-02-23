#!/usr/bin/env node

/**
 * Test script for LiveKit SIP endpoint
 */

import { runSipTest } from './dist/sip/engine.js';

async function main() {
  const config = {
    uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
    method: 'OPTIONS',
    codecs: ['opus', 'PCMU'],
    transport: 'udp',
    mediaPort: 10000,
    timeout: 10000
  };

  console.log('Testing LiveKit SIP endpoint...\n');
  console.log(`URI: ${config.uri}`);
  console.log(`Method: ${config.method}\n`);

  try {
    for await (const event of runSipTest(config)) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const status = event.status ? ` [${event.status}]` : '';
      console.log(`[${time}] ${event.type}: ${event.message}${status}`);
      
      if (event.sdpOffer) {
        console.log('\n--- SDP Offer ---');
        console.log(event.sdpOffer);
        console.log('--- End SDP ---\n');
      }
      
      if (event.sdpAnswer) {
        console.log('\n--- SDP Answer ---');
        console.log(event.sdpAnswer);
        console.log('--- End SDP ---\n');
      }
    }
    
    console.log('\n✅ Test completed successfully');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
