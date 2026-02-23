import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SAMPLE_FILES: Record<string, string> = {
  'sine-440hz': 'sine-440hz.wav',
  'sine-1000hz': 'sine-1000hz.wav',
  'dtmf-123': 'dtmf-123.wav',
  'voice-hello': 'voice-hello.wav',
  'silence': 'silence.wav',
};

/**
 * Resolve an audio sample name to an absolute file path.
 * Returns null if the file doesn't exist.
 */
export function getAudioSamplePath(sample: string): string | null {
  const filename = SAMPLE_FILES[sample];
  const filePath = filename
    ? resolve(__dirname, '../../audio-samples', filename)
    : sample;

  if (!existsSync(filePath)) return null;
  return filePath;
}
