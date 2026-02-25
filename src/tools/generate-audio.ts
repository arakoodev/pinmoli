import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const GenerateAudioParamsSchema = Type.Object({
  type: Type.Union([
    Type.Literal('sine'),
    Type.Literal('dtmf'),
    Type.Literal('silence'),
    Type.Literal('speech')
  ], { description: 'Type of audio to generate' }),
  filename: Type.String({ description: 'Output filename (without extension)' }),
  frequency: Type.Optional(Type.Number({ 
    minimum: 20, 
    maximum: 20000,
    description: 'Frequency in Hz (for sine waves)' 
  })),
  duration: Type.Optional(Type.Number({ 
    minimum: 0.1, 
    maximum: 30,
    description: 'Duration in seconds' 
  })),
  text: Type.Optional(Type.String({ 
    description: 'Text to synthesize (for speech)' 
  })),
  digits: Type.Optional(Type.String({
    pattern: '^[0-9*#A-Da-d]+$',
    description: 'DTMF digits to generate (0-9, *, #, A-D)'
  }))
});

type GenerateAudioParams = Static<typeof GenerateAudioParamsSchema>;

/**
 * Generate custom audio samples at runtime
 */
export const generateAudioTool: AgentTool = {
  name: 'generate_audio',
  label: 'Generate Audio Sample',
  description: 'Generate custom audio samples for SIP testing (sine waves, DTMF tones, speech, silence)',
  parameters: GenerateAudioParamsSchema,

  async execute(toolCallId, params, signal, onUpdate) {
    const { type, filename, frequency = 440, duration = 3, text, digits } = params as GenerateAudioParams;

    // Ensure audio-samples directory exists
    const samplesDir = resolve(process.cwd(), 'audio-samples');
    if (!existsSync(samplesDir)) {
      mkdirSync(samplesDir, { recursive: true });
    }

    const outputPath = resolve(samplesDir, `${filename}.wav`);

    onUpdate?.({
      content: [{ type: 'text', text: `Generating ${type} audio: ${filename}.wav...` }],
      details: { status: 'generating' }
    });

    try {
      let success = false;

      switch (type) {
        case 'sine':
          success = await generateSine(outputPath, frequency, duration);
          break;
        case 'dtmf':
          success = await generateDTMF(outputPath, digits || '123', duration);
          break;
        case 'silence':
          success = await generateSilence(outputPath, duration);
          break;
        case 'speech':
          success = await generateSpeech(outputPath, text || 'Hello');
          break;
      }

      if (success) {
        return {
          content: [{
            type: 'text',
            text: `✓ Generated ${filename}.wav (${type})\nLocation: audio-samples/${filename}.wav\nUse with: audioSample: '${filename}'`
          }],
          details: { 
            filename: `${filename}.wav`,
            path: outputPath,
            type,
            success: true
          }
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: `✗ Failed to generate audio. ffmpeg may not be available.`
          }],
          details: { success: false }
        };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `✗ Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        details: { success: false, error: String(error) }
      };
    }
  }
};

async function generateSine(output: string, frequency: number, duration: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}`,
      '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1', '-y',
      output
    ]);

    ffmpeg.on('close', (code) => resolve(code === 0));
    ffmpeg.on('error', () => resolve(false));
    const timer = setTimeout(() => { ffmpeg.kill(); resolve(false); }, 10000);
    timer.unref();
  });
}

// DTMF dual-tone frequency pairs (ITU-T Q.23)
const DTMF_FREQ_MAP: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], 'A': [697, 1633],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477], 'B': [770, 1633],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], 'C': [852, 1633],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477], 'D': [941, 1633],
};

async function generateDTMF(output: string, digits: string, _duration: number): Promise<boolean> {
  // Build filter_complex: each digit is a dual-tone + silence gap, concatenated
  const digitDuration = 0.16; // 160ms per digit
  const gapDuration = 0.1;   // 100ms silence between digits
  const filters: string[] = [];
  const inputLabels: string[] = [];

  for (let i = 0; i < digits.length; i++) {
    const freqs = DTMF_FREQ_MAP[digits[i].toUpperCase()];
    if (!freqs) continue;
    const [lo, hi] = freqs;

    // Dual-tone for this digit
    const toneLabel = `t${i}`;
    filters.push(
      `aevalsrc='0.5*sin(2*PI*${lo}*t)+0.5*sin(2*PI*${hi}*t)':s=8000:d=${digitDuration}[${toneLabel}]`
    );
    inputLabels.push(`[${toneLabel}]`);

    // Silence gap after digit (except last)
    if (i < digits.length - 1) {
      const gapLabel = `g${i}`;
      filters.push(`aevalsrc=0:s=8000:d=${gapDuration}[${gapLabel}]`);
      inputLabels.push(`[${gapLabel}]`);
    }
  }

  if (inputLabels.length === 0) return false;

  // Concatenate all segments
  const concatFilter = `${inputLabels.join('')}concat=n=${inputLabels.length}:v=0:a=1[out]`;
  filters.push(concatFilter);

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-filter_complex', filters.join(';'),
      '-map', '[out]',
      '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1', '-y',
      output
    ]);

    ffmpeg.on('close', (code) => resolve(code === 0));
    ffmpeg.on('error', () => resolve(false));
    const timer = setTimeout(() => { ffmpeg.kill(); resolve(false); }, 10000);
    timer.unref();
  });
}

async function generateSilence(output: string, duration: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'lavfi', '-i', `anullsrc=duration=${duration}`,
      '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1', '-y',
      output
    ]);

    ffmpeg.on('close', (code) => resolve(code === 0));
    ffmpeg.on('error', () => resolve(false));
    const timer = setTimeout(() => { ffmpeg.kill(); resolve(false); }, 10000);
    timer.unref();
  });
}

async function generateSpeech(output: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Use unique temp path to avoid collisions between concurrent generations
    const tmpFile = `/tmp/speech-${Date.now()}-${process.pid}.wav`;
    const espeak = spawn('espeak', [text, '-w', tmpFile]);

    espeak.on('close', (code) => {
      if (code === 0) {
        // Convert to PCMU
        const ffmpeg = spawn('ffmpeg', [
          '-i', tmpFile,
          '-acodec', 'pcm_mulaw', '-ar', '8000', '-ac', '1', '-y',
          output
        ]);
        ffmpeg.on('close', (code2) => resolve(code2 === 0));
        ffmpeg.on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    });

    espeak.on('error', () => resolve(false));
    const timer = setTimeout(() => { espeak.kill(); resolve(false); }, 10000);
    timer.unref();
  });
}
