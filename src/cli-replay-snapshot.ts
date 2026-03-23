#!/usr/bin/env node

/**
 * Replay interactive SIP calls from saved scenario snapshots.
 *
 * Scans session subdirectories for scenario-manifest.json files,
 * replays each scenario against the real SIP endpoint, and compares results.
 *
 * Usage:
 *   npx tsx src/cli-replay-snapshot.ts <session-dir> [--scenario <name>]
 */

import { readdirSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { initCliSession } from './network/session.js';
import { replayFromSnapshot, readScenarioManifest } from './sip/replay-snapshot.js';
import { terminateAll } from './sip/call-store.js';
import type { ReplaySnapshotResult } from './sip/replay-snapshot.js';

function log(msg: string) { process.stderr.write(msg + '\n'); }

async function main() {
  const args = process.argv.slice(2);
  const sessionPath = args.find(a => !a.startsWith('--'));
  const scenarioIdx = args.indexOf('--scenario');
  const scenarioFilter = scenarioIdx >= 0 ? args[scenarioIdx + 1] : undefined;

  if (scenarioIdx >= 0 && (!scenarioFilter || scenarioFilter.startsWith('--'))) {
    log('Error: --scenario requires a value');
    process.exit(1);
  }

  if (!sessionPath || args.includes('--help') || args.includes('-h')) {
    log(`Pinmoli Snapshot Replay — replay interactive calls from saved snapshots

Usage:
  npx tsx src/cli-replay-snapshot.ts <session-dir> [--scenario <name>]

Examples:
  npx tsx src/cli-replay-snapshot.ts captures/20260322-084530-568y
  npx tsx src/cli-replay-snapshot.ts captures/20260322-084530-568y --scenario 2-multi-turn

The session directory must contain subdirectories with scenario-manifest.json files
(created by run-scenarios.ts).`);
    process.exit(sessionPath ? 0 : 1);
  }

  const absPath = resolve(sessionPath);
  if (!existsSync(absPath)) {
    log(`Error: ${absPath} does not exist`);
    process.exit(1);
  }

  // Find scenario dirs (subdirs with scenario-manifest.json)
  const entries = readdirSync(absPath, { withFileTypes: true });
  let scenarioDirs = entries
    .filter(e => e.isDirectory())
    .map(e => resolve(absPath, e.name))
    .filter(dir => existsSync(resolve(dir, 'scenario-manifest.json')));

  if (scenarioFilter) {
    scenarioDirs = scenarioDirs.filter(dir => {
      const manifest = readScenarioManifest(dir);
      return manifest?.scenario === scenarioFilter;
    });
  }

  if (scenarioDirs.length === 0) {
    log(`No scenario-manifest.json files found in ${absPath}`);
    if (scenarioFilter) log(`(filtered by --scenario ${scenarioFilter})`);
    process.exit(1);
  }

  // Initialize replay session root
  const replayRoot = initCliSession();

  log('=== Pinmoli Snapshot Replay ===');
  log(`Source:    ${basename(absPath)}`);
  log(`Replay:   ${replayRoot}`);
  log(`Scenarios: ${scenarioDirs.length}`);
  log('');

  const results: ReplaySnapshotResult[] = [];

  for (const dir of scenarioDirs) {
    const manifest = readScenarioManifest(dir);
    log(`--- ${manifest?.scenario || basename(dir)} ---`);

    const result = await replayFromSnapshot(dir, log);
    results.push(result);

    const status = result.passed ? 'PASS' : 'FAIL';
    const dur = (result.replayDurationMs / 1000).toFixed(1);
    const origDur = (result.originalDurationMs / 1000).toFixed(1);
    log(`  ${status} | ${dur}s (original: ${origDur}s)`);

    for (const tr of result.turnResults) {
      const match = tr.audioMatch ? 'MATCH' : 'DIFFER';
      log(`    Turn ${tr.turn}: ${tr.replayPackets} pkts (original: ${tr.originalPackets}) — ${match}`);
    }

    if (result.comparison) {
      log(`  Comparison:`);
      log(result.comparison);
    }
    log('');

    // Pause between scenarios to avoid overwhelming the SIP endpoint
    await new Promise(r => setTimeout(r, 2000));
  }

  // Cleanup any leftover calls
  await terminateAll();

  // Summary
  const passed = results.filter(r => r.passed).length;
  log('=== Summary ===');
  log(`Scenarios: ${passed}/${results.length} passed`);

  for (const r of results) {
    const icon = r.passed ? 'OK' : 'XX';
    log(`  [${icon}] ${r.scenario}: ${(r.replayDurationMs / 1000).toFixed(1)}s`);
  }

  log(`\nReplay results: ${replayRoot}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(err => { log(`Fatal: ${err}`); process.exit(1); });
