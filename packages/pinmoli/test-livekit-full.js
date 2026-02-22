#!/usr/bin/env node

/**
 * Test script for LiveKit SIP endpoint with INVITE
 */

import { executeSipTest } from './dist/sip/transport.js';

async function testOptions() {
  console.log('=== Test 1: OPTIONS (connectivity check) ===\n');
  
  const config = {
    uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
    method: 'OPTIONS',
    codecs: ['opus', 'PCMU'],
    transport: 'udp',
    mediaPort: 10000,
    timeout: 10000
  };

  try {
    for await (const event of executeSipTest(config)) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const status = event.status ? ` [${event.status}]` : '';
      console.log(`[${time}] ${event.type}: ${event.message}${status}`);
    }
    console.log('✅ OPTIONS test passed\n');
    return true;
  } catch (error) {
    console.error('❌ OPTIONS test failed:', error.message);
    return false;
  }
}

async function testInvite() {
  console.log('=== Test 2: INVITE (voice call) ===\n');
  
  const config = {
    uri: 'sip:5eezfwavhxe.sip.livekit.cloud',
    method: 'INVITE',
    codecs: ['opus', 'PCMU'],
    transport: 'udp',
    mediaPort: 10000,
    timeout: 15000
  };

  try {
    for await (const event of executeSipTest(config)) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const status = event.status ? ` [${event.status}]` : '';
      console.log(`[${time}] ${event.type}: ${event.message}${status}`);
      
      if (event.sdpAnswer) {
        console.log('\n--- SDP Answer Received ---');
        console.log(event.sdpAnswer.substring(0, 200) + '...');
        console.log('--- End SDP ---\n');
      }
    }
    console.log('✅ INVITE test passed\n');
    return true;
  } catch (error) {
    console.error('❌ INVITE test failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🎙️  Testing LiveKit SIP Endpoint\n');
  console.log('Endpoint: sip:5eezfwavhxe.sip.livekit.cloud\n');
  
  const optionsOk = await testOptions();
  if (!optionsOk) {
    process.exit(1);
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const inviteOk = await testInvite();
  if (!inviteOk) {
    process.exit(1);
  }
  
  console.log('\n🎉 All tests passed!');
}

main();
