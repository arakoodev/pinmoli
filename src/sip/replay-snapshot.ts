/**
 * Replay interactive SIP calls from saved scenario snapshots.
 *
 * Reads scenario-manifest.json from a previous session directory,
 * starts a real SIP call, sends the exact same WAV files in order,
 * listens for the same durations, and compares results.
 *
 * No TTS, no LLM — just saved audio driving a new live call.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { openDialog, sendAudio, receiveAudio, closeDialog } from './call-session.js';
import { terminateAll } from './call-store.js';
import { buildFlowFromEvents, writeFlowJson, readFlowJson, compareFlows } from '../network/flow.js';
import type { TestEvent } from '../validation/schemas.js';

// ---- Manifest types ----

export interface ScenarioManifestTurn {
  sendAudioFile: string;
  listenSeconds: number;
  responseAudioFile: string;
  packetsReceived: number;
}

export interface ScenarioManifestExtraListen {
  listenSeconds: number;
  audioFile: string;
  packetsReceived: number;
}

export interface ScenarioManifest {
  version: number;
  scenario: string;
  description: string;
  uri: string;
  codecs: string[];
  greetingListen: number;
  greetingAudioFile?: string;
  greetingPacketsReceived?: number;
  turns: ScenarioManifestTurn[];
  extraListens: ScenarioManifestExtraListen[];
  result: {
    passed: boolean;
    durationMs: number;
    totalPacketsSent: number;
    totalPacketsReceived: number;
  };
}

// ---- Result types ----

export interface TurnResult {
  turn: number;
  originalPackets: number;
  replayPackets: number;
  audioMatch: boolean;
}

export interface ReplaySnapshotResult {
  scenario: string;
  passed: boolean;
  turnResults: TurnResult[];
  comparison: string;
  replayDurationMs: number;
  originalDurationMs: number;
}

// ---- Manifest I/O ----

export function readScenarioManifest(scenarioDir: string): ScenarioManifest | null {
  const manifestPath = resolve(scenarioDir, 'scenario-manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function validateManifest(manifest: ScenarioManifest, scenarioDir: string): string[] {
  const errors: string[] = [];

  if (manifest.version !== 1) {
    errors.push(`Unsupported manifest version: ${manifest.version}`);
  }
  if (!manifest.uri) {
    errors.push('Missing SIP URI');
  }
  if (!Array.isArray(manifest.codecs) || manifest.codecs.length === 0) {
    errors.push('Missing codecs');
  }
  if (!Array.isArray(manifest.turns) || manifest.turns.length === 0) {
    errors.push('No turns defined');
  }
  if (!manifest.result || typeof manifest.result !== 'object') {
    errors.push('Missing result');
  }

  if (Array.isArray(manifest.turns)) {
    for (const turn of manifest.turns) {
      if (!turn.sendAudioFile || typeof turn.sendAudioFile !== 'string') {
        errors.push('Turn missing sendAudioFile');
        continue;
      }
      const sendPath = resolve(scenarioDir, turn.sendAudioFile);
      if (!existsSync(sendPath)) {
        errors.push(`Missing audio file: ${turn.sendAudioFile}`);
      }
    }
  }

  return errors;
}

// ---- Comparison helpers ----

/** Both got audio or both got silence */
export function audioMatch(original: number, replay: number): boolean {
  return (original > 0) === (replay > 0);
}

/** Packet counts within tolerance (default ±30%) */
export function packetCountWithinTolerance(original: number, replay: number, tolerance = 0.3): boolean {
  if (original === 0 && replay === 0) return true;
  if (original === 0 || replay === 0) return false;
  const ratio = replay / original;
  return ratio >= (1 - tolerance) && ratio <= (1 + tolerance);
}

// ---- Replay engine ----

export async function replayFromSnapshot(
  scenarioDir: string,
  onLog: (msg: string) => void,
): Promise<ReplaySnapshotResult> {
  const manifest = readScenarioManifest(scenarioDir);
  if (!manifest) {
    throw new Error(`No scenario-manifest.json in ${scenarioDir}`);
  }

  const errors = validateManifest(manifest, scenarioDir);
  if (errors.length > 0) {
    throw new Error(`Invalid manifest: ${errors.join(', ')}`);
  }

  const events: TestEvent[] = [];
  const emit = (ev: TestEvent) => { events.push(ev); };
  const t0 = Date.now();
  const turnResults: TurnResult[] = [];

  onLog(`Replaying: ${manifest.scenario} — ${manifest.description}`);
  onLog(`URI: ${manifest.uri}`);
  onLog(`Turns: ${manifest.turns.length}`);

  try {
    const handle = await openDialog({
      uri: manifest.uri,
      codecs: manifest.codecs,
      timeout: 30000,
    }, emit);

    onLog(`Call established — codec: ${handle.negotiatedCodec.name}`);

    // Optional greeting listen
    if (manifest.greetingListen > 0) {
      onLog(`Listening for greeting (${manifest.greetingListen}s)...`);
      await receiveAudio(handle, manifest.greetingListen, emit);
    }

    // Execute turns — send saved WAV, listen for same duration
    for (let i = 0; i < manifest.turns.length; i++) {
      const turn = manifest.turns[i];
      const audioPath = resolve(scenarioDir, turn.sendAudioFile);

      onLog(`Turn ${i + 1}: sending ${turn.sendAudioFile}...`);
      await sendAudio(handle, audioPath, emit);

      onLog(`Turn ${i + 1}: listening (${turn.listenSeconds}s)...`);
      const result = await receiveAudio(handle, turn.listenSeconds, emit);

      const match = audioMatch(turn.packetsReceived, result.packetsReceived);
      turnResults.push({
        turn: i + 1,
        originalPackets: turn.packetsReceived,
        replayPackets: result.packetsReceived,
        audioMatch: match,
      });

      onLog(`Turn ${i + 1}: ${result.packetsReceived} pkts (original: ${turn.packetsReceived}) — ${match ? 'MATCH' : 'DIFFER'}`);
    }

    // Extra listens (e.g. silence phase)
    for (const extra of manifest.extraListens) {
      onLog(`Extra listen (${extra.listenSeconds}s)...`);
      await receiveAudio(handle, extra.listenSeconds, emit);
    }

    // Close dialog
    await closeDialog(handle, emit);
    onLog('Call terminated');

    // Build replay flow + compare (non-critical — don't mask call result)
    let comparison: string;
    try {
      const replayFlow = buildFlowFromEvents(events, {
        protocol: 'sip',
        method: 'INVITE',
        uri: manifest.uri,
      });
      writeFlowJson(handle.session, replayFlow);

      const originalFlow = readFlowJson(scenarioDir);
      comparison = originalFlow
        ? compareFlows(originalFlow, replayFlow)
        : '(no original flow.json for comparison)';
    } catch {
      comparison = '(flow comparison unavailable)';
    }

    return {
      scenario: manifest.scenario,
      passed: turnResults.every(t => t.audioMatch),
      turnResults,
      comparison,
      replayDurationMs: Date.now() - t0,
      originalDurationMs: manifest.result.durationMs,
    };
  } catch (error) {
    await terminateAll();

    return {
      scenario: manifest.scenario,
      passed: false,
      turnResults,
      comparison: `Error: ${error instanceof Error ? error.message : String(error)}`,
      replayDurationMs: Date.now() - t0,
      originalDurationMs: manifest.result.durationMs,
    };
  }
}
