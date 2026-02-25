/**
 * Audio Frame Utilities for WebRTC
 * PCM16 frame chunking for werift MediaStreamTrack, WAV save for received audio.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { tmpdir } from 'os';

/** 20ms of PCM16 at 48kHz stereo = 3840 bytes (960 samples * 2 channels * 2 bytes) */
const OPUS_FRAME_SAMPLES = 960;

/** 20ms of PCM16 at 8kHz mono = 320 bytes (160 samples * 1 channel * 2 bytes) */
const PCMU_FRAME_SAMPLES = 160;

export interface AudioFrameConfig {
  sampleRate: number;  // 48000 for opus, 8000 for PCMU
  channels: number;    // 1 for mono, 2 for stereo
}

/**
 * Load a WAV file and return PCM16 frames suitable for werift.
 * Uses ffmpeg to convert to the target sample rate/channels.
 * Returns array of Int16Array frames (20ms each).
 */
export function loadAudioAsFrames(
  wavPath: string,
  config: AudioFrameConfig
): Int16Array[] {
  if (!existsSync(wavPath)) {
    throw new Error(`Audio file not found: ${wavPath}`);
  }

  const samplesPerFrame = config.sampleRate === 48000
    ? OPUS_FRAME_SAMPLES
    : PCMU_FRAME_SAMPLES;

  // Convert to raw PCM16LE at target sample rate/channels via ffmpeg
  const tmpFile = resolve(tmpdir(), `pinmoli-pcm-${Date.now()}-${Math.random().toString(36).slice(2)}.raw`);
  try {
    execSync(
      `ffmpeg -y -i "${wavPath}" -f s16le -acodec pcm_s16le -ar ${config.sampleRate} -ac ${config.channels} "${tmpFile}"`,
      { stdio: 'pipe' }
    );
  } catch (err) {
    throw new Error(`ffmpeg conversion failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const raw = readFileSync(tmpFile);

  // Clean up temp file
  try { execSync(`rm "${tmpFile}"`, { stdio: 'pipe' }); } catch { /* ignore */ }

  const samplesPerFrameTotal = samplesPerFrame * config.channels;
  const bytesPerFrame = samplesPerFrameTotal * 2; // 16-bit = 2 bytes
  const frames: Int16Array[] = [];

  for (let offset = 0; offset + bytesPerFrame <= raw.length; offset += bytesPerFrame) {
    const frame = new Int16Array(samplesPerFrameTotal);
    for (let i = 0; i < samplesPerFrameTotal; i++) {
      frame[i] = raw.readInt16LE(offset + i * 2);
    }
    frames.push(frame);
  }

  return frames;
}

/**
 * Save received PCM16 audio frames as a WAV file.
 */
export function saveReceivedAudio(
  frames: Int16Array[],
  config: AudioFrameConfig,
  outputPath: string
): void {
  if (frames.length === 0) return;

  // Combine all frames into a single buffer
  const totalSamples = frames.reduce((sum, f) => sum + f.length, 0);
  const raw = Buffer.alloc(totalSamples * 2);
  let offset = 0;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      raw.writeInt16LE(frame[i], offset);
      offset += 2;
    }
  }

  // Build WAV header for PCM16
  const header = Buffer.alloc(44);
  const byteRate = config.sampleRate * config.channels * 2;
  const blockAlign = config.channels * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + raw.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);              // fmt chunk size
  header.writeUInt16LE(1, 20);               // format: PCM
  header.writeUInt16LE(config.channels, 22);
  header.writeUInt32LE(config.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);              // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(raw.length, 40);

  writeFileSync(outputPath, Buffer.concat([header, raw]));
}
