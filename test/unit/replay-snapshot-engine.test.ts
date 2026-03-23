/**
 * State machine tests for replayFromSnapshot().
 *
 * Mocks call-session and call-store so we can verify the replay engine
 * drives the correct sequence of openDialog → sendAudio → receiveAudio →
 * closeDialog without hitting a real SIP endpoint.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';

// Mock network-dependent modules (hoisted before imports)
vi.mock('../../src/sip/call-session.js', () => ({
  openDialog: vi.fn(),
  sendAudio: vi.fn(),
  receiveAudio: vi.fn(),
  closeDialog: vi.fn(),
}));

vi.mock('../../src/sip/call-store.js', () => ({
  terminateAll: vi.fn(),
}));

vi.mock('../../src/network/flow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/network/flow.js')>();
  return { ...actual, writeFlowJson: vi.fn() };
});

import { replayFromSnapshot } from '../../src/sip/replay-snapshot.js';
import type { ScenarioManifest } from '../../src/sip/replay-snapshot.js';
import { openDialog, sendAudio, receiveAudio, closeDialog } from '../../src/sip/call-session.js';
import { terminateAll } from '../../src/sip/call-store.js';

const TMP_ROOT = `/tmp/replay-engine-test-${process.pid}`;
const SRC_DIR = resolve(TMP_ROOT, 'original');
const DST_DIR = resolve(TMP_ROOT, 'replay');

function makeMockSession() {
  return {
    dir: DST_DIR,
    name: 'test-replay',
    logSignaling: vi.fn(),
    writeMetadata: vi.fn(),
    file: (name: string) => resolve(DST_DIR, name),
  };
}

function writeManifest(manifest: ScenarioManifest, dir = SRC_DIR) {
  writeFileSync(resolve(dir, 'scenario-manifest.json'), JSON.stringify(manifest, null, 2));
}

const SINGLE_TURN: ScenarioManifest = {
  version: 1,
  scenario: 'test-single',
  description: 'Single turn test',
  uri: 'sip:+1234@test.host',
  codecs: ['PCMU'],
  greetingListen: 0,
  turns: [
    { sendAudioFile: 'sent-audio-1.wav', listenSeconds: 10, responseAudioFile: 'agent-response-2.wav', packetsReceived: 100 },
  ],
  extraListens: [],
  result: { passed: true, durationMs: 15000, totalPacketsSent: 50, totalPacketsReceived: 100 },
};

describe('replayFromSnapshot (state machine)', () => {
  beforeAll(() => {
    mkdirSync(SRC_DIR, { recursive: true });
    mkdirSync(DST_DIR, { recursive: true });
    // Create audio file so validation passes
    writeFileSync(resolve(SRC_DIR, 'sent-audio-1.wav'), Buffer.alloc(44));
    writeFileSync(resolve(SRC_DIR, 'sent-audio-2.wav'), Buffer.alloc(44));
    writeFileSync(resolve(SRC_DIR, 'sent-audio-3.wav'), Buffer.alloc(44));
  });

  afterAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock setup
    const session = makeMockSession();
    vi.mocked(openDialog).mockResolvedValue({ negotiatedCodec: { name: 'PCMU' }, session } as never);
    vi.mocked(sendAudio).mockResolvedValue(undefined);
    vi.mocked(receiveAudio).mockResolvedValue({ filePath: resolve(DST_DIR, 'agent-response-2.wav'), packetsReceived: 95 });
    vi.mocked(closeDialog).mockResolvedValue(undefined);
  });

  it('drives correct call sequence for single-turn', async () => {
    writeManifest(SINGLE_TURN);

    const result = await replayFromSnapshot(SRC_DIR, () => {});

    expect(vi.mocked(openDialog)).toHaveBeenCalledOnce();
    expect(vi.mocked(openDialog)).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'sip:+1234@test.host', codecs: ['PCMU'] }),
      expect.any(Function),
    );
    expect(vi.mocked(sendAudio)).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAudio)).toHaveBeenCalledWith(
      expect.anything(),
      resolve(SRC_DIR, 'sent-audio-1.wav'),
      expect.any(Function),
    );
    expect(vi.mocked(receiveAudio)).toHaveBeenCalledOnce();
    expect(vi.mocked(receiveAudio)).toHaveBeenCalledWith(
      expect.anything(),
      10,
      expect.any(Function),
    );
    expect(vi.mocked(closeDialog)).toHaveBeenCalledOnce();

    expect(result.passed).toBe(true);
    expect(result.scenario).toBe('test-single');
    expect(result.turnResults).toHaveLength(1);
    expect(result.turnResults[0]).toMatchObject({
      turn: 1,
      originalPackets: 100,
      replayPackets: 95,
      audioMatch: true,
    });
  });

  it('drives correct sequence for multi-turn', async () => {
    const multiTurn: ScenarioManifest = {
      ...SINGLE_TURN,
      scenario: 'test-multi',
      turns: [
        { sendAudioFile: 'sent-audio-1.wav', listenSeconds: 15, responseAudioFile: 'agent-response-2.wav', packetsReceived: 100 },
        { sendAudioFile: 'sent-audio-3.wav', listenSeconds: 10, responseAudioFile: 'agent-response-4.wav', packetsReceived: 200 },
      ],
    };
    writeManifest(multiTurn);

    vi.mocked(receiveAudio)
      .mockResolvedValueOnce({ filePath: resolve(DST_DIR, 'agent-response-2.wav'), packetsReceived: 95 })
      .mockResolvedValueOnce({ filePath: resolve(DST_DIR, 'agent-response-4.wav'), packetsReceived: 180 });

    const result = await replayFromSnapshot(SRC_DIR, () => {});

    expect(vi.mocked(sendAudio)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(receiveAudio)).toHaveBeenCalledTimes(2);
    // Second receive should use the second turn's listenSeconds
    expect(vi.mocked(receiveAudio)).toHaveBeenNthCalledWith(2, expect.anything(), 10, expect.any(Function));

    expect(result.turnResults).toHaveLength(2);
    expect(result.turnResults[0].audioMatch).toBe(true);
    expect(result.turnResults[1].audioMatch).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('listens for greeting before first send', async () => {
    const greetingManifest: ScenarioManifest = {
      ...SINGLE_TURN,
      scenario: 'test-greeting',
      greetingListen: 5,
      turns: [
        { sendAudioFile: 'sent-audio-2.wav', listenSeconds: 20, responseAudioFile: 'agent-response-3.wav', packetsReceived: 800 },
      ],
    };
    writeManifest(greetingManifest);

    vi.mocked(receiveAudio)
      .mockResolvedValueOnce({ filePath: resolve(DST_DIR, 'agent-response-1.wav'), packetsReceived: 400 })
      .mockResolvedValueOnce({ filePath: resolve(DST_DIR, 'agent-response-3.wav'), packetsReceived: 750 });

    const result = await replayFromSnapshot(SRC_DIR, () => {});

    // First receiveAudio is greeting (5s), second is the turn (20s)
    expect(vi.mocked(receiveAudio)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(receiveAudio)).toHaveBeenNthCalledWith(1, expect.anything(), 5, expect.any(Function));
    expect(vi.mocked(receiveAudio)).toHaveBeenNthCalledWith(2, expect.anything(), 20, expect.any(Function));
    // sendAudio should be called once (for the turn, not the greeting)
    expect(vi.mocked(sendAudio)).toHaveBeenCalledOnce();
    expect(result.passed).toBe(true);
  });

  it('calls terminateAll on openDialog failure', async () => {
    writeManifest(SINGLE_TURN);
    vi.mocked(openDialog).mockRejectedValue(new Error('Connection refused'));

    const result = await replayFromSnapshot(SRC_DIR, () => {});

    expect(vi.mocked(terminateAll)).toHaveBeenCalledOnce();
    expect(result.passed).toBe(false);
    expect(result.comparison).toContain('Connection refused');
  });

  it('reports audio mismatch when replay gets silence', async () => {
    writeManifest(SINGLE_TURN);
    // Original had 100 packets, replay gets 0
    vi.mocked(receiveAudio).mockResolvedValue({
      filePath: resolve(DST_DIR, 'agent-response-2.wav'),
      packetsReceived: 0,
    });

    const result = await replayFromSnapshot(SRC_DIR, () => {});

    expect(result.passed).toBe(false);
    expect(result.turnResults[0].audioMatch).toBe(false);
    expect(result.turnResults[0].originalPackets).toBe(100);
    expect(result.turnResults[0].replayPackets).toBe(0);
  });

  it('collects log messages via onLog callback', async () => {
    writeManifest(SINGLE_TURN);
    const logs: string[] = [];

    await replayFromSnapshot(SRC_DIR, (msg) => logs.push(msg));

    expect(logs.some(l => l.includes('Replaying: test-single'))).toBe(true);
    expect(logs.some(l => l.includes('Turn 1:'))).toBe(true);
    expect(logs.some(l => l.includes('Call terminated'))).toBe(true);
  });

  it('handles extra listens', async () => {
    const withExtra: ScenarioManifest = {
      ...SINGLE_TURN,
      scenario: 'test-extra',
      extraListens: [
        { listenSeconds: 15, audioFile: 'agent-response-3.wav', packetsReceived: 0 },
      ],
    };
    writeManifest(withExtra);

    vi.mocked(receiveAudio)
      .mockResolvedValueOnce({ filePath: resolve(DST_DIR, 'agent-response-2.wav'), packetsReceived: 95 })
      .mockResolvedValueOnce({ filePath: resolve(DST_DIR, 'agent-response-3.wav'), packetsReceived: 0 });

    const result = await replayFromSnapshot(SRC_DIR, () => {});

    // 1 turn receive + 1 extra listen
    expect(vi.mocked(receiveAudio)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(receiveAudio)).toHaveBeenNthCalledWith(2, expect.anything(), 15, expect.any(Function));
    expect(result.passed).toBe(true);
  });
});
