import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { isVertexConfigured } from '../commands/service-account.js';
import { getSessionRoot } from '../network/session.js';
import { codecByName, CODEC_TABLE, type CodecInfo } from '../sip/codec.js';

const GenerateAudioParamsSchema = Type.Object({
  type: Type.Union([
    Type.Literal('sine'),
    Type.Literal('dtmf'),
    Type.Literal('silence'),
    Type.Literal('speech')
  ], { description: 'Type of audio to generate: sine (pure tone), dtmf (dual-tone digits), silence, or speech (TTS via espeak or gemini).' }),
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
  })),
  codec: Type.Optional(Type.Union([
    Type.Literal('PCMU'),
    Type.Literal('PCMA'),
    Type.Literal('G722'),
  ], {
    description: 'Audio codec for the generated WAV file: PCMU (mu-law 8kHz), PCMA (A-law 8kHz), or G722 (wideband 16kHz). Default: PCMU.'
  })),
  ttsProvider: Type.Optional(Type.Union([
    Type.Literal('espeak'),
    Type.Literal('gemini'),
  ], {
    description: 'TTS engine for speech generation: espeak (fast, offline, robotic — good for stress-testing agent comprehension) or gemini (high quality, natural, Vertex AI). Default: espeak.'
  })),
  language: Type.Optional(Type.String({
    description: 'Language code for espeak TTS (e.g. "ja" for Japanese, "en" for English, "es" for Spanish, "fr" for French, "de" for German, "zh" for Chinese). Gemini auto-detects language from the text. Default: "en".'
  })),
  voice: Type.Optional(Type.String({
    description: 'Voice name for Gemini TTS: Zephyr, Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Pegasus. Default: Kore.'
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
    const { type, filename, frequency = 440, duration = 3, text, digits, codec: codecName, ttsProvider, language, voice } = params as GenerateAudioParams;
    const codec: CodecInfo = codecName ? (codecByName(codecName) ?? CODEC_TABLE.PCMU) : CODEC_TABLE.PCMU;

    // Save audio-samples under the CLI session directory
    const samplesDir = resolve(getSessionRoot(), 'audio-samples');
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
          success = await generateSine(outputPath, frequency, duration, codec);
          break;
        case 'dtmf':
          success = await generateDTMF(outputPath, digits || '123', duration, codec);
          break;
        case 'silence':
          success = await generateSilence(outputPath, duration, codec);
          break;
        case 'speech':
          success = await generateSpeech(outputPath, text || 'Hello', codec, ttsProvider, language, voice);
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

async function generateSine(output: string, frequency: number, duration: number, codec: CodecInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}`,
      '-acodec', codec.ffmpegCodec, '-ar', String(codec.sampleRate), '-ac', '1', '-y',
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

async function generateDTMF(output: string, digits: string, _duration: number, codec: CodecInfo): Promise<boolean> {
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
      '-acodec', codec.ffmpegCodec, '-ar', String(codec.sampleRate), '-ac', '1', '-y',
      output
    ]);

    ffmpeg.on('close', (code) => resolve(code === 0));
    ffmpeg.on('error', () => resolve(false));
    const timer = setTimeout(() => { ffmpeg.kill(); resolve(false); }, 10000);
    timer.unref();
  });
}

async function generateSilence(output: string, duration: number, codec: CodecInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'lavfi', '-i', `anullsrc=duration=${duration}`,
      '-acodec', codec.ffmpegCodec, '-ar', String(codec.sampleRate), '-ac', '1', '-y',
      output
    ]);

    ffmpeg.on('close', (code) => resolve(code === 0));
    ffmpeg.on('error', () => resolve(false));
    const timer = setTimeout(() => { ffmpeg.kill(); resolve(false); }, 10000);
    timer.unref();
  });
}

async function generateSpeech(output: string, text: string, codec: CodecInfo, ttsProvider?: string, language?: string, voice?: string): Promise<boolean> {
  // Gemini TTS path — high quality, Vertex AI only
  if (ttsProvider === 'gemini') {
    if (!isVertexConfigured() && !process.env.GEMINI_API_KEY) {
      throw new Error('Gemini TTS requires Vertex AI (--service-account) or GEMINI_API_KEY.');
    }
    const { synthesizeSpeech, wrapAudioAsWav } = await import('../google/tts.js');

    // Gemini TTS returns audio/L16 (PCM signed 16-bit, typically 24kHz mono).
    // We MUST wrap it in a WAV that matches the actual sample rate/encoding,
    // then transcode to the target SIP codec via ffmpeg. NEVER assume the
    // bytes are already in the target format — that produces garbled noise.
    const result = await synthesizeSpeech(text, voice ? { voice } : undefined);

    // Wrap the actual response (typically PCM16 24kHz) in a proper WAV
    const tmpFile = `/tmp/gemini-tts-${Date.now()}-${process.pid}.wav`;
    writeFileSync(tmpFile, wrapAudioAsWav(result));

    try {
      // Always transcode through ffmpeg — handles sample rate conversion
      // (24kHz → 8kHz/16kHz) and codec conversion (PCM16 → mu-law/A-law/G722)
      return await new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i', tmpFile,
          '-acodec', codec.ffmpegCodec, '-ar', String(codec.sampleRate), '-ac', '1', '-y',
          output
        ]);
        ffmpeg.on('close', (code) => resolve(code === 0));
        ffmpeg.on('error', () => resolve(false));
        const timer = setTimeout(() => { ffmpeg.kill(); resolve(false); }, 15000);
        timer.unref();
      });
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  // espeak path (default) — fast, offline, robotic
  return new Promise((resolve) => {
    // Use unique temp path to avoid collisions between concurrent generations
    const tmpFile = `/tmp/speech-${Date.now()}-${process.pid}.wav`;
    const espeakArgs = [text, '-w', tmpFile];
    if (language) {
      espeakArgs.push('-v', language);
    }
    const espeak = spawn('espeak', espeakArgs);

    espeak.on('close', (code) => {
      if (code === 0) {
        // Convert to target codec
        const ffmpeg = spawn('ffmpeg', [
          '-i', tmpFile,
          '-acodec', codec.ffmpegCodec, '-ar', String(codec.sampleRate), '-ac', '1', '-y',
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
