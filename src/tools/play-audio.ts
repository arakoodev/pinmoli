/**
 * play_audio tool — play a WAV file through the speaker via PulseAudio.
 *
 * Pipeline: ffmpeg (decode any WAV codec to raw PCM) | paplay (PulseAudio output)
 * Requires PULSE_SERVER env var pointing to a PulseAudio socket (WSLg, native, etc.)
 */

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { spawn, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { getAudioSamplePath } from '../sip/audio.js';

const PlayAudioParamsSchema = Type.Object({
  filePath: Type.String({
    description:
      'WAV file to play. Accepts: audio sample name (e.g. "voice-hello"), ' +
      'session-generated filename (e.g. "jp-greeting"), or absolute path ' +
      'from receive_audio result (e.g. "/app/captures/.../agent-response-2.wav").',
  }),
});

type PlayAudioConfig = Static<typeof PlayAudioParamsSchema>;

/** Get audio duration in seconds via ffprobe. Returns null on failure. */
function probeDuration(filePath: string): number | null {
  try {
    const output = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { encoding: 'utf8', timeout: 5000 });
    const seconds = parseFloat(output.trim());
    return isNaN(seconds) ? null : seconds;
  } catch {
    return null;
  }
}

/** Play a WAV file through ffmpeg → paplay. Returns when playback finishes or is aborted. */
function playWav(
  filePath: string,
  signal: AbortSignal,
): Promise<{ success: boolean; durationMs: number; error?: string }> {
  return new Promise((resolve) => {
    const startMs = Date.now();

    const ffmpeg = spawn('ffmpeg', [
      '-i', filePath,
      '-f', 's16le', '-ar', '44100', '-ac', '1',
      '-loglevel', 'error',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const paplay = spawn('paplay', [
      '--raw', '--rate=44100', '--channels=1', '--format=s16le',
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    ffmpeg.stdout.pipe(paplay.stdin);

    let settled = false;
    const finish = (success: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve({ success, durationMs: Date.now() - startMs, error });
    };

    const onAbort = () => {
      ffmpeg.kill();
      paplay.kill();
      finish(false, 'Playback stopped');
    };

    signal.addEventListener('abort', onAbort, { once: true });

    // Collect stderr for error reporting
    let paplayStderr = '';
    paplay.stderr.on('data', (chunk: Buffer) => { paplayStderr += chunk.toString(); });

    ffmpeg.stderr.on('data', () => { /* drain stderr */ });

    paplay.on('close', (code) => {
      finish(code === 0, code !== 0 ? (paplayStderr.trim() || `paplay exit ${code}`) : undefined);
    });

    paplay.on('error', (err) => finish(false, `paplay error: ${err.message}`));
    ffmpeg.on('error', (err) => { paplay.kill(); finish(false, `ffmpeg error: ${err.message}`); });

    // Safety timeout — 120s max playback
    const timer = setTimeout(() => { ffmpeg.kill(); paplay.kill(); }, 120000);
    timer.unref();
  });
}

export const playAudioTool: AgentTool = {
  name: 'play_audio',
  label: 'Play Audio',
  description:
    'Play a WAV audio file through the speaker. Use to listen to agent responses ' +
    '(from receive_audio), generated speech (from generate_audio), or built-in samples. ' +
    'Requires PulseAudio (available via WSLg on WSL2).',
  parameters: PlayAudioParamsSchema,

  async execute(toolCallId, params, signal, onUpdate) {
    const config = params as PlayAudioConfig;
    const t0 = Date.now();

    const emit = (msg: string) => {
      const elapsed = `+${((Date.now() - t0) / 1000).toFixed(3)}s`;
      onUpdate?.({
        content: [{ type: 'text', text: `[INFO] ${elapsed} ${msg}` }],
        details: {},
      });
    };

    // Check PulseAudio availability — playback works best on the host
    if (!process.env.PULSE_SERVER) {
      // Resolve file path for the host-side hint
      const hintPath = getAudioSamplePath(config.filePath) || config.filePath;
      return {
        content: [{
          type: 'text',
          text: `Audio playback requires PulseAudio (not available inside this container). ` +
            `Play on the host instead:\n\n  ./bin/pinmoli-play ${hintPath}\n\n` +
            `Or set PULSE_SERVER to enable in-container playback.`,
        }],
        details: { error: 'no_pulse_server', filePath: hintPath },
      };
    }

    // Resolve file path
    const resolved = getAudioSamplePath(config.filePath);
    if (!resolved) {
      // Try as-is for absolute paths that getAudioSamplePath doesn't handle
      if (!existsSync(config.filePath)) {
        return {
          content: [{ type: 'text', text: `Audio file not found: ${config.filePath}` }],
          details: { error: 'file_not_found', filePath: config.filePath },
        };
      }
    }

    const filePath = resolved || config.filePath;

    // Probe duration
    const duration = probeDuration(filePath);
    const durStr = duration ? `${duration.toFixed(1)}s` : 'unknown duration';
    emit(`Playing ${filePath} (${durStr})...`);

    // Play (use a no-op AbortSignal if none provided)
    const abortSignal = signal ?? new AbortController().signal;
    const result = await playWav(filePath, abortSignal);

    if (result.success) {
      const playedStr = (result.durationMs / 1000).toFixed(1);
      emit(`Playback complete (${playedStr}s)`);
      return {
        content: [{
          type: 'text',
          text: `Played ${config.filePath} (${durStr})`,
        }],
        details: { filePath, durationMs: result.durationMs },
      };
    } else {
      emit(`Playback failed: ${result.error}`);
      return {
        content: [{
          type: 'text',
          text: `Playback failed: ${result.error}`,
        }],
        details: { error: result.error, filePath },
      };
    }
  },
};
