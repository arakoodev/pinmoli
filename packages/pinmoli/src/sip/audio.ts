import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Available audio samples
 */
export const AUDIO_SAMPLES = {
  'sine-440hz': 'sine-440hz.wav',
  'sine-1000hz': 'sine-1000hz.wav',
  'dtmf-123': 'dtmf-123.wav',
  'voice-hello': 'voice-hello.wav',
  'silence': 'silence.wav',
} as const;

export type AudioSample = keyof typeof AUDIO_SAMPLES;

/**
 * Stream audio file via RTP using ffmpeg
 */
export async function streamAudioFile(
  sample: AudioSample | string,
  remoteIp: string,
  remotePort: number
): Promise<boolean> {
  // Resolve sample name to file path
  let filePath: string;
  
  if (sample in AUDIO_SAMPLES) {
    filePath = resolve(__dirname, '../../audio-samples', AUDIO_SAMPLES[sample as AudioSample]);
  } else {
    filePath = sample; // Assume it's a direct file path
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    return false;
  }

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-re', '-i', filePath,
      '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1',
      '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`,
    ]);

    ffmpeg.on('close', (code) => {
      resolve(code === 0);
    });

    ffmpeg.on('error', () => {
      resolve(false);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      ffmpeg.kill();
      resolve(false);
    }, 10000);
  });
}

/**
 * Generate audio on-the-fly using ffmpeg lavfi
 */
export async function streamGeneratedAudio(
  type: 'sine' | 'dtmf' | 'silence',
  remoteIp: string,
  remotePort: number,
  options?: {
    frequency?: number;
    duration?: number;
    digits?: string;
  }
): Promise<boolean> {
  const { frequency = 440, duration = 3, digits = '123' } = options || {};

  let lavfiInput: string;

  switch (type) {
    case 'sine':
      lavfiInput = `sine=frequency=${frequency}:duration=${duration}`;
      break;
    case 'silence':
      lavfiInput = `anullsrc=duration=${duration}`;
      break;
    case 'dtmf':
      // Simple DTMF generation (just use sine for now)
      lavfiInput = `sine=frequency=697:duration=${duration}`;
      break;
    default:
      return false;
  }

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-re', '-f', 'lavfi', '-i', lavfiInput,
      '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1',
      '-f', 'rtp', `rtp://${remoteIp}:${remotePort}`,
    ]);

    ffmpeg.on('close', (code) => {
      resolve(code === 0);
    });

    ffmpeg.on('error', () => {
      resolve(false);
    });

    // Timeout
    setTimeout(() => {
      ffmpeg.kill();
      resolve(false);
    }, (duration + 2) * 1000);
  });
}

/**
 * Resolve an audio sample name to an absolute file path.
 * Returns null if the file doesn't exist.
 */
export function getAudioSamplePath(sample: AudioSample | string): string | null {
  let filePath: string;

  if (sample in AUDIO_SAMPLES) {
    filePath = resolve(__dirname, '../../audio-samples', AUDIO_SAMPLES[sample as AudioSample]);
  } else {
    filePath = sample; // Assume it's a direct file path
  }

  if (!existsSync(filePath)) return null;
  return filePath;
}

/**
 * List available audio samples
 */
export function listAudioSamples(): Array<{ name: string; file: string }> {
  return Object.entries(AUDIO_SAMPLES).map(([name, file]) => ({
    name,
    file,
  }));
}
