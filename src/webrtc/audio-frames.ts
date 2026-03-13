/**
 * Audio Frame Utilities for WebRTC
 * PCM16 frame chunking for werift MediaStreamTrack, WAV save for received audio.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
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

// ---- OGG Opus container builder (for decoding opus RTP payloads via ffmpeg) ----

/**
 * OGG CRC-32 lookup table.
 * Polynomial: 0x04C11DB7, init=0, no reflection, no final XOR.
 */
const OGG_CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) {
    r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1);
  }
  OGG_CRC_TABLE[i] = r >>> 0;
}

function oggCrc32(data: Buffer): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xFF]) >>> 0;
  }
  return crc;
}

function buildOggPage(
  granulePos: bigint,
  serialNo: number,
  pageSeqNo: number,
  headerType: number,
  payload: Buffer,
): Buffer {
  // Segment table: each segment max 255 bytes
  const segments: number[] = [];
  let remaining = payload.length;
  while (remaining >= 255) {
    segments.push(255);
    remaining -= 255;
  }
  segments.push(remaining);

  const headerSize = 27 + segments.length;
  const page = Buffer.alloc(headerSize + payload.length);

  page.write('OggS', 0);
  page[4] = 0; // version
  page[5] = headerType;
  page.writeBigInt64LE(granulePos, 6);
  page.writeUInt32LE(serialNo, 14);
  page.writeUInt32LE(pageSeqNo, 18);
  page.writeUInt32LE(0, 22); // CRC placeholder
  page[26] = segments.length;
  for (let i = 0; i < segments.length; i++) {
    page[27 + i] = segments[i];
  }
  payload.copy(page, headerSize);

  // Compute CRC over complete page
  page.writeUInt32LE(oggCrc32(page), 22);

  return page;
}

function buildOpusHead(channels: number, sampleRate: number): Buffer {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0);
  head[8] = 1; // version
  head[9] = channels;
  head.writeUInt16LE(0, 10); // pre-skip
  head.writeUInt32LE(sampleRate, 12);
  head.writeUInt16LE(0, 16); // output gain
  head[18] = 0; // channel mapping family
  return head;
}

function buildOpusTags(): Buffer {
  const vendor = 'pinmoli';
  const buf = Buffer.alloc(8 + 4 + vendor.length + 4);
  buf.write('OpusTags', 0);
  buf.writeUInt32LE(vendor.length, 8);
  buf.write(vendor, 12);
  buf.writeUInt32LE(0, 12 + vendor.length); // 0 comments
  return buf;
}

/**
 * Decode opus RTP payloads to PCM16 WAV via OGG container + ffmpeg.
 * Builds a minimal RFC 7845 OGG Opus stream from individual frames.
 */
function decodeOpusPayloads(
  payloads: Buffer[],
  config: AudioFrameConfig,
  outputPath: string,
): void {
  if (payloads.length === 0) return;

  const serialNo = 1;
  const pages: Buffer[] = [];

  // BOS page: OpusHead
  pages.push(buildOggPage(0n, serialNo, 0, 0x02, buildOpusHead(config.channels, config.sampleRate)));
  // Tags page: OpusTags
  pages.push(buildOggPage(0n, serialNo, 1, 0x00, buildOpusTags()));

  // Audio pages: one per opus frame
  const samplesPerFrame = config.sampleRate === 48000 ? 960 : 160;
  let granulePos = BigInt(0);

  for (let i = 0; i < payloads.length; i++) {
    granulePos += BigInt(samplesPerFrame);
    const isLast = i === payloads.length - 1;
    pages.push(buildOggPage(
      granulePos,
      serialNo,
      i + 2,
      isLast ? 0x04 : 0x00, // EOS on last page
      payloads[i],
    ));
  }

  const tmpOgg = resolve(tmpdir(), `pinmoli-ogg-${Date.now()}-${process.pid}.ogg`);
  try {
    writeFileSync(tmpOgg, Buffer.concat(pages));
    execFileSync('ffmpeg', [
      '-i', tmpOgg,
      '-acodec', 'pcm_s16le',
      '-ar', String(config.sampleRate),
      '-ac', String(config.channels),
      '-y', outputPath,
    ], { stdio: 'pipe', timeout: 30000 });
  } finally {
    try { unlinkSync(tmpOgg); } catch { /* ignore */ }
  }
}

/**
 * Save raw RTP payloads as WAV, handling codec decoding.
 * - PCMU: writes mu-law WAV (format code 7).
 * - opus: builds OGG container, decodes via ffmpeg to PCM16 WAV.
 */
export function savePayloadsAsWav(
  payloads: Buffer[],
  codec: 'opus' | 'PCMU',
  config: AudioFrameConfig,
  outputPath: string,
): void {
  if (payloads.length === 0) return;

  // Ensure output directory exists
  const dir = resolve(outputPath, '..');
  mkdirSync(dir, { recursive: true });

  if (codec === 'PCMU') {
    const data = Buffer.concat(payloads);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);      // fmt chunk size
    header.writeUInt16LE(7, 20);       // format: mu-law
    header.writeUInt16LE(1, 22);       // channels
    header.writeUInt32LE(8000, 24);    // sample rate
    header.writeUInt32LE(8000, 28);    // byte rate
    header.writeUInt16LE(1, 32);       // block align
    header.writeUInt16LE(8, 34);       // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    writeFileSync(outputPath, Buffer.concat([header, data]));
  } else {
    decodeOpusPayloads(payloads, config, outputPath);
  }
}
