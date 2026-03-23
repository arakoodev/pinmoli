#!/usr/bin/env node

/**
 * Direct scenario runner — calls SIP interactive tools programmatically.
 * No LLM needed. Exercises start_call → send_audio → receive_audio → end_call.
 *
 * Usage: docker compose exec pinmoli npx tsx test/scenarios/run-scenarios.ts
 */

import { openDialog, sendAudio, receiveAudio, closeDialog } from '../../src/sip/call-session.js';
import { getAudioSamplePath } from '../../src/sip/audio.js';
import { initCliSession } from '../../src/network/session.js';
import { terminateAll } from '../../src/sip/call-store.js';
import type { CallHandle } from '../../src/sip/call-store.js';
import type { TestEvent } from '../../src/validation/schemas.js';
import { writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { buildFlowFromEvents, writeFlowJson } from '../../src/network/flow.js';
import type { ScenarioManifest } from '../../src/sip/replay-snapshot.js';

const SIP_URI = `sip:${process.env.LIVEKIT_PHONE || '+18144693283'}@${process.env.LIVEKIT_SIP_ENDPOINT || '5789pyhutlx.sip.livekit.cloud'}`;

interface Scenario {
  name: string;
  description: string;
  /** Audio samples to send in sequence. 'voice-hello' = built-in, others = generate later */
  turns: Array<{
    send: string;          // audio sample name
    listenSeconds: number; // how long to listen after sending
  }>;
  /** Seconds to listen for agent greeting before first send */
  greetingListen: number;
}

const SCENARIOS: Scenario[] = [
  {
    name: '1-new-customer',
    description: 'Send greeting, listen for response (mirrors "Call recording Yamada Testing")',
    greetingListen: 0,
    turns: [
      { send: 'voice-hello', listenSeconds: 15 },
    ],
  },
  {
    name: '2-multi-turn',
    description: 'Two-turn conversation: greeting + follow-up (mirrors "Japanese call 6")',
    greetingListen: 0,
    turns: [
      { send: 'voice-hello', listenSeconds: 15 },
      { send: 'voice-hello', listenSeconds: 15 },
    ],
  },
  {
    name: '3-listen-first',
    description: 'Listen for agent greeting before speaking (mirrors "yamada bee farm japanese")',
    greetingListen: 8,
    turns: [
      { send: 'voice-hello', listenSeconds: 20 },
    ],
  },
  {
    name: '4-silence-test',
    description: 'Connect and listen without sending — test agent timeout behavior',
    greetingListen: 0,
    turns: [
      { send: 'voice-hello', listenSeconds: 10 },
      // Don't send again — just listen
    ],
  },
  {
    name: '5-rapid-exchange',
    description: 'Three quick turns — stress test RTP continuity across sends',
    greetingListen: 0,
    turns: [
      { send: 'voice-hello', listenSeconds: 10 },
      { send: 'voice-hello', listenSeconds: 10 },
      { send: 'voice-hello', listenSeconds: 10 },
    ],
  },
];

interface ScenarioResult {
  name: string;
  description: string;
  passed: boolean;
  callEstablished: boolean;
  byeSent: boolean;
  totalPacketsReceived: number;
  totalPacketsSent: number;
  turns: number;
  durationMs: number;
  sessionDir?: string;
  error?: string;
  events: TestEvent[];
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const events: TestEvent[] = [];
  const emit = (ev: TestEvent) => { events.push(ev); };
  const t0 = Date.now();
  let handle: CallHandle | undefined;
  let totalIn = 0;
  let totalOut = 0;
  let callEstablished = false;
  let byeSent = false;

  // Per-turn tracking for scenario manifest
  const turnInfos: ScenarioManifest['turns'] = [];
  const extraListenInfos: ScenarioManifest['extraListens'] = [];
  let greetingAudioFile: string | undefined;
  let greetingPacketsReceived: number | undefined;

  try {
    // Open dialog
    handle = await openDialog({ uri: SIP_URI, codecs: ['PCMU'], timeout: 30000 }, emit);
    callEstablished = true;

    // Optional: listen for greeting first
    if (scenario.greetingListen > 0) {
      const greeting = await receiveAudio(handle, scenario.greetingListen, emit);
      totalIn += greeting.packetsReceived;
      greetingAudioFile = basename(greeting.filePath);
      greetingPacketsReceived = greeting.packetsReceived;
    }

    // Execute turns
    for (const turn of scenario.turns) {
      const samplePath = getAudioSamplePath(turn.send);
      if (samplePath) {
        await sendAudio(handle, samplePath, emit);
        totalOut += handle.rtpStreamState?.packetsSent ?? 0;
      }

      const sendFile = `sent-audio-${handle.turnCounter}.wav`;
      const result = await receiveAudio(handle, turn.listenSeconds, emit);
      totalIn += result.packetsReceived;

      turnInfos.push({
        sendAudioFile: sendFile,
        listenSeconds: turn.listenSeconds,
        responseAudioFile: basename(result.filePath),
        packetsReceived: result.packetsReceived,
      });
    }

    // Silence phase for scenario 4
    if (scenario.name === '4-silence-test') {
      const silence = await receiveAudio(handle, 15, emit);
      totalIn += silence.packetsReceived;
      extraListenInfos.push({
        listenSeconds: 15,
        audioFile: basename(silence.filePath),
        packetsReceived: silence.packetsReceived,
      });
    }

    // Close
    await closeDialog(handle, emit);
    byeSent = true;

    // Write scenario manifest + flow.json for replay (non-critical)
    try {
      const flow = buildFlowFromEvents(events, { protocol: 'sip', method: 'INVITE', uri: SIP_URI });
      writeFlowJson(handle.session, flow);

      const manifest: ScenarioManifest = {
        version: 1,
        scenario: scenario.name,
        description: scenario.description,
        uri: SIP_URI,
        codecs: ['PCMU'],
        greetingListen: scenario.greetingListen,
        ...(greetingAudioFile && { greetingAudioFile }),
        ...(greetingPacketsReceived !== undefined && { greetingPacketsReceived }),
        turns: turnInfos,
        extraListens: extraListenInfos,
        result: {
          passed: callEstablished && byeSent,
          durationMs: Date.now() - t0,
          totalPacketsSent: totalOut,
          totalPacketsReceived: totalIn,
        },
      };
      writeFileSync(handle.session.file('scenario-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    } catch { /* don't mask scenario result */ }

    return {
      name: scenario.name,
      description: scenario.description,
      passed: callEstablished && byeSent,
      callEstablished,
      byeSent,
      totalPacketsReceived: totalIn,
      totalPacketsSent: totalOut,
      turns: scenario.turns.length,
      durationMs: Date.now() - t0,
      sessionDir: handle.session.dir,
      events,
    };
  } catch (error) {
    // Try to clean up
    if (handle && handle.state !== 'terminated') {
      try { await closeDialog(handle, () => {}); byeSent = true; } catch { /* */ }
    }

    return {
      name: scenario.name,
      description: scenario.description,
      passed: false,
      callEstablished,
      byeSent,
      totalPacketsReceived: totalIn,
      totalPacketsSent: totalOut,
      turns: scenario.turns.length,
      durationMs: Date.now() - t0,
      sessionDir: handle?.session.dir,
      error: error instanceof Error ? error.message : String(error),
      events,
    };
  }
}

// Use stderr for immediate output (unbuffered), write summary to file
function log(msg: string) { process.stderr.write(msg + '\n'); }

async function main() {
  const sessionRoot = initCliSession();
  log('=== Pinmoli Scenario Runner (direct) ===');
  log(`Session: ${sessionRoot}`);
  log(`Target:  ${SIP_URI}`);
  log(`Scenarios: ${SCENARIOS.length}`);
  log('');

  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS) {
    log(`--- ${scenario.name}: ${scenario.description} ---`);
    const result = await runScenario(scenario);
    results.push(result);

    const status = result.passed ? 'PASS' : 'FAIL';
    const dur = (result.durationMs / 1000).toFixed(1);
    log(`  ${status} | ${dur}s | RTP out: ${result.totalPacketsSent} | RTP in: ${result.totalPacketsReceived}${result.error ? ` | Error: ${result.error}` : ''}`);
    log('');

    // Brief pause between scenarios to avoid overwhelming the SIP endpoint
    // Do NOT .unref() — Node exits early if no referenced timers remain
    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const withAudio = results.filter(r => r.totalPacketsReceived > 0).length;
  log('=== Summary ===');
  log(`Scenarios: ${passed}/${results.length} passed (call established + BYE)`);
  log(`Audio received: ${withAudio}/${results.length} scenarios got agent audio`);
  log('');

  for (const r of results) {
    const icon = r.passed ? (r.totalPacketsReceived > 0 ? 'OK' : '--') : 'XX';
    log(`  [${icon}] ${r.name}: ${(r.durationMs/1000).toFixed(1)}s, ${r.totalPacketsReceived} pkts in, ${r.totalPacketsSent} pkts out`);
  }

  // Write JSON results to session dir
  const jsonResults = results.map(({ events: _e, ...rest }) => rest);
  writeFileSync(resolve(sessionRoot, 'scenario-results.json'), JSON.stringify(jsonResults, null, 2) + '\n');
  log(`\nResults written to: ${sessionRoot}/scenario-results.json`);

  // Cleanup any leftover calls
  await terminateAll();
}

main().catch(err => { console.error(`Fatal: ${err}`); process.exit(1); });
