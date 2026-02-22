#!/usr/bin/env node

/**
 * Demo: Test SIP engine streaming
 */

import { runSipTest } from '../src/sip/engine.js';

const config = {
  uri: 'sip:test@sip.example.com',
  method: 'OPTIONS',
  codecs: ['opus', 'PCMU'],
  transport: 'udp',
  mediaPort: 10000,
  timeout: 2000
};

console.log('Testing SIP engine with streaming events...\n');

try {
  for await (const event of runSipTest(config)) {
    const timestamp = new Date(event.timestamp).toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] [${event.type.toUpperCase()}] ${event.message}`);
    
    if (event.status) {
      console.log(`  Status: ${event.status}`);
    }
  }
} catch (error) {
  console.error('Error:', error);
}

console.log('\nDemo complete!');
