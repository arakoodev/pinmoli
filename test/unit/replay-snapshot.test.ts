import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import {
  audioMatch,
  packetCountWithinTolerance,
  validateManifest,
  readScenarioManifest,
} from '../../src/sip/replay-snapshot.js';
import type { ScenarioManifest } from '../../src/sip/replay-snapshot.js';

const VALID_MANIFEST: ScenarioManifest = {
  version: 1,
  scenario: '1-new-customer',
  description: 'Send greeting, listen for response',
  uri: 'sip:+18144693283@5789pyhutlx.sip.livekit.cloud',
  codecs: ['PCMU'],
  greetingListen: 0,
  turns: [
    {
      sendAudioFile: 'sent-audio-1.wav',
      listenSeconds: 15,
      responseAudioFile: 'agent-response-2.wav',
      packetsReceived: 735,
    },
  ],
  extraListens: [],
  result: {
    passed: true,
    durationMs: 18200,
    totalPacketsSent: 130,
    totalPacketsReceived: 735,
  },
};

describe('replay-snapshot', () => {
  describe('audioMatch', () => {
    it('returns true when both have audio', () => {
      expect(audioMatch(100, 200)).toBe(true);
    });

    it('returns true when both are silent', () => {
      expect(audioMatch(0, 0)).toBe(true);
    });

    it('returns false when original has audio but replay is silent', () => {
      expect(audioMatch(100, 0)).toBe(false);
    });

    it('returns false when replay has audio but original is silent', () => {
      expect(audioMatch(0, 100)).toBe(false);
    });
  });

  describe('packetCountWithinTolerance', () => {
    it('returns true for both zero', () => {
      expect(packetCountWithinTolerance(0, 0)).toBe(true);
    });

    it('returns false when one is zero', () => {
      expect(packetCountWithinTolerance(100, 0)).toBe(false);
      expect(packetCountWithinTolerance(0, 100)).toBe(false);
    });

    it('returns true within default 30% tolerance', () => {
      expect(packetCountWithinTolerance(100, 110)).toBe(true);
      expect(packetCountWithinTolerance(100, 90)).toBe(true);
      expect(packetCountWithinTolerance(100, 130)).toBe(true);
      expect(packetCountWithinTolerance(100, 70)).toBe(true);
    });

    it('returns false outside default 30% tolerance', () => {
      expect(packetCountWithinTolerance(100, 131)).toBe(false);
      expect(packetCountWithinTolerance(100, 69)).toBe(false);
    });

    it('respects custom tolerance', () => {
      expect(packetCountWithinTolerance(100, 150, 0.5)).toBe(true);
      expect(packetCountWithinTolerance(100, 151, 0.5)).toBe(false);
    });

    it('handles exact boundary values (inclusive)', () => {
      // 30% of 1000 = 300, so boundaries are 700 and 1300
      expect(packetCountWithinTolerance(1000, 700)).toBe(true);
      expect(packetCountWithinTolerance(1000, 1300)).toBe(true);
      expect(packetCountWithinTolerance(1000, 699)).toBe(false);
      expect(packetCountWithinTolerance(1000, 1301)).toBe(false);
    });

    it('handles large packet counts', () => {
      expect(packetCountWithinTolerance(50000, 60000)).toBe(true);
      expect(packetCountWithinTolerance(50000, 70000)).toBe(false);
    });

    it('handles small differences near 1', () => {
      expect(packetCountWithinTolerance(1, 1)).toBe(true);
      expect(packetCountWithinTolerance(1, 2)).toBe(false); // 100% off
    });
  });

  describe('validateManifest', () => {
    it('reports missing audio files', () => {
      const errors = validateManifest(VALID_MANIFEST, '/tmp/nonexistent-' + Date.now());
      expect(errors).toContain('Missing audio file: sent-audio-1.wav');
    });

    it('catches unsupported version', () => {
      const errors = validateManifest({ ...VALID_MANIFEST, version: 99 }, '/tmp');
      expect(errors).toContain('Unsupported manifest version: 99');
    });

    it('catches missing URI', () => {
      const errors = validateManifest({ ...VALID_MANIFEST, uri: '' }, '/tmp');
      expect(errors).toContain('Missing SIP URI');
    });

    it('catches empty codecs', () => {
      const errors = validateManifest({ ...VALID_MANIFEST, codecs: [] }, '/tmp');
      expect(errors).toContain('Missing codecs');
    });

    it('catches empty turns', () => {
      const errors = validateManifest({ ...VALID_MANIFEST, turns: [] }, '/tmp');
      expect(errors).toContain('No turns defined');
    });

    it('returns no errors with valid manifest and existing files', () => {
      const tmpDir = `/tmp/replay-validate-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(resolve(tmpDir, 'sent-audio-1.wav'), Buffer.alloc(44));
      try {
        const errors = validateManifest(VALID_MANIFEST, tmpDir);
        expect(errors).toEqual([]);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('catches non-array codecs from corrupted JSON', () => {
      const bad = { ...VALID_MANIFEST, codecs: 'PCMU' as unknown as string[] };
      const errors = validateManifest(bad, '/tmp');
      expect(errors).toContain('Missing codecs');
    });

    it('catches non-array turns from corrupted JSON', () => {
      const bad = { ...VALID_MANIFEST, turns: 'not-an-array' as unknown as typeof VALID_MANIFEST.turns };
      const errors = validateManifest(bad, '/tmp');
      expect(errors).toContain('No turns defined');
    });

    it('catches missing result object', () => {
      const bad = { ...VALID_MANIFEST, result: null as unknown as typeof VALID_MANIFEST.result };
      const errors = validateManifest(bad, '/tmp');
      expect(errors).toContain('Missing result');
    });

    it('catches turn with missing sendAudioFile', () => {
      const tmpDir = `/tmp/replay-badturn-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      try {
        const bad = {
          ...VALID_MANIFEST,
          turns: [{ sendAudioFile: '', listenSeconds: 10, responseAudioFile: 'r.wav', packetsReceived: 0 }],
        };
        const errors = validateManifest(bad, tmpDir);
        expect(errors).toContain('Turn missing sendAudioFile');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('reports multiple errors at once', () => {
      const bad = { ...VALID_MANIFEST, version: 2, uri: '', codecs: [] as string[], turns: [] as typeof VALID_MANIFEST.turns };
      const errors = validateManifest(bad, '/tmp');
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });

    it('validates multi-turn manifest with all files present', () => {
      const tmpDir = `/tmp/replay-multi-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(resolve(tmpDir, 'sent-audio-1.wav'), Buffer.alloc(44));
      writeFileSync(resolve(tmpDir, 'sent-audio-3.wav'), Buffer.alloc(44));
      try {
        const multi = {
          ...VALID_MANIFEST,
          turns: [
            { sendAudioFile: 'sent-audio-1.wav', listenSeconds: 15, responseAudioFile: 'agent-response-2.wav', packetsReceived: 735 },
            { sendAudioFile: 'sent-audio-3.wav', listenSeconds: 15, responseAudioFile: 'agent-response-4.wav', packetsReceived: 740 },
          ],
        };
        const errors = validateManifest(multi, tmpDir);
        expect(errors).toEqual([]);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('reports each missing file in multi-turn manifest', () => {
      const tmpDir = `/tmp/replay-multimiss-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(resolve(tmpDir, 'sent-audio-1.wav'), Buffer.alloc(44));
      // sent-audio-3.wav intentionally missing
      try {
        const multi = {
          ...VALID_MANIFEST,
          turns: [
            { sendAudioFile: 'sent-audio-1.wav', listenSeconds: 15, responseAudioFile: 'r2.wav', packetsReceived: 735 },
            { sendAudioFile: 'sent-audio-3.wav', listenSeconds: 15, responseAudioFile: 'r4.wav', packetsReceived: 740 },
          ],
        };
        const errors = validateManifest(multi, tmpDir);
        expect(errors).toContain('Missing audio file: sent-audio-3.wav');
        expect(errors).not.toContain('Missing audio file: sent-audio-1.wav');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('readScenarioManifest', () => {
    it('returns null for non-existent directory', () => {
      expect(readScenarioManifest('/tmp/does-not-exist-' + Date.now())).toBeNull();
    });

    it('reads a valid manifest from disk', () => {
      const tmpDir = `/tmp/replay-read-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        resolve(tmpDir, 'scenario-manifest.json'),
        JSON.stringify(VALID_MANIFEST, null, 2),
      );
      try {
        const result = readScenarioManifest(tmpDir);
        expect(result).toEqual(VALID_MANIFEST);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns null for malformed JSON', () => {
      const tmpDir = `/tmp/replay-malformed-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(resolve(tmpDir, 'scenario-manifest.json'), 'not json');
      try {
        expect(readScenarioManifest(tmpDir)).toBeNull();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns null for empty file', () => {
      const tmpDir = `/tmp/replay-empty-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(resolve(tmpDir, 'scenario-manifest.json'), '');
      try {
        expect(readScenarioManifest(tmpDir)).toBeNull();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns parsed value for valid JSON array (caller must validate)', () => {
      const tmpDir = `/tmp/replay-array-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(resolve(tmpDir, 'scenario-manifest.json'), '[1,2,3]');
      try {
        // readScenarioManifest doesn't validate structure — it just parses JSON
        const result = readScenarioManifest(tmpDir);
        expect(result).toEqual([1, 2, 3]);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('round-trips a manifest through write + read', () => {
      const tmpDir = `/tmp/replay-roundtrip-${Date.now()}`;
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        resolve(tmpDir, 'scenario-manifest.json'),
        JSON.stringify(VALID_MANIFEST, null, 2) + '\n',
      );
      try {
        const result = readScenarioManifest(tmpDir);
        expect(result).toEqual(VALID_MANIFEST);
        const errors = validateManifest(result!, tmpDir);
        // Only error should be missing audio file (we didn't create it)
        expect(errors).toEqual(['Missing audio file: sent-audio-1.wav']);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
