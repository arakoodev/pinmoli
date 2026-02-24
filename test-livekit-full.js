#!/usr/bin/env node

/**
 * Test script for LiveKit SIP endpoint with INVITE
 * Uses the full URI from .env (sip:+1234567890@host)
 */

import { runSipTest } from './dist/sip/engine.js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from repo root
config({ path: resolve(__dirname, '.env') });

const endpoint = process.env.LIVEKIT_ENDPOINT || 'sip:5eezfwavhxe.sip.livekit.cloud';
// Extract host from endpoint for OPTIONS (no phone number needed)
const hostMatch = endpoint.match(/@([^:;]+)/);
const host = hostMatch ? hostMatch[1] : endpoint.replace(/^sip:/, '');

async function testOptions() {
  console.log('=== Test 1: OPTIONS (connectivity check) ===\n');

  const cfg = {
    uri: `sip:${host}`,
    method: 'OPTIONS',
    codecs: ['opus', 'PCMU'],
    transport: 'udp',
    mediaPort: 10000,
    timeout: 10000
  };

  try {
    for await (const event of runSipTest(cfg)) {
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
  console.log('=== Test 2: INVITE (full voice call with audio) ===\n');

  const cfg = {
    uri: endpoint,
    method: 'INVITE',
    codecs: ['opus', 'PCMU'],
    transport: 'udp',
    mediaPort: 10000,
    timeout: 30000,
    audioSample: 'voice-hello',
    responseWaitTime: 15,
  };

  try {
    for await (const event of runSipTest(cfg)) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const status = event.status ? ` [${event.status}]` : '';
      console.log(`[${time}] ${event.type}: ${event.message}${status}`);

      if (event.sdpAnswer) {
        console.log('\n--- SDP Answer ---');
        console.log(event.sdpAnswer);
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
  console.log(`Endpoint: ${endpoint}\n`);

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
