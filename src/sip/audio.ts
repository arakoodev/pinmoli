import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSessionRoot } from '../network/session.js';

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
 *
 * Search order:
 * 1. Built-in samples (audio-samples/ next to src/)
 * 2. Session-scoped samples ({session}/audio-samples/)
 * 3. Raw path (absolute or relative)
 *
 * Returns null if the file doesn't exist.
 */
export function getAudioSamplePath(sample: string): string | null {
  const filename = SAMPLE_FILES[sample];

  if (filename) {
    // Built-in sample
    const builtIn = resolve(__dirname, '../../audio-samples', filename);
    if (existsSync(builtIn)) return builtIn;
  }

  // Session-scoped generated sample (e.g. from generate_audio tool)
  const sessionPath = resolve(getSessionRoot(), 'audio-samples', `${sample}.wav`);
  if (existsSync(sessionPath)) return sessionPath;

  // Raw path fallback
  if (existsSync(sample)) return sample;

  return null;
}

/**
 * Find the most recently generated audio sample in the current session.
 * Returns the sample name (without .wav) or null if none exist.
 *
 * Used when INVITE is called without audioSample — auto-picks the last
 * generated TTS/audio so the user doesn't have to wire filenames manually.
 */
export function getLatestSessionSample(): string | null {
  const samplesDir = resolve(getSessionRoot(), 'audio-samples');
  if (!existsSync(samplesDir)) return null;

  const files = readdirSync(samplesDir)
    .filter(f => f.endsWith('.wav'))
    .map(f => ({ name: f.replace(/\.wav$/, ''), mtime: statSync(resolve(samplesDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].name : null;
}
