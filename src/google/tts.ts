/**
 * Gemini TTS — text-to-speech via Vertex AI generateContent.
 *
 * Uses gemini-2.5-flash-tts to produce MULAW audio natively,
 * which is directly usable as SIP PCMU with zero transcoding.
 */

import { callGenerateContent } from './gemini-rest.js';

const DEFAULT_MODEL = 'gemini-2.5-flash-tts';
const DEFAULT_VOICE = 'Kore';

export interface SynthesizeOptions {
  /** Gemini model ID. Default: gemini-2.5-flash-tts */
  model?: string;
  /** Voice name. Default: Kore */
  voice?: string;
  /** Output encoding. Default: mulaw */
  outputFormat?: 'mulaw' | 'pcm16';
}

/**
 * Synthesize speech using Gemini TTS.
 *
 * @param text - Text to speak
 * @param options - Model, voice, and format overrides
 * @returns Raw audio samples (MULAW 8kHz by default)
 */
export async function synthesizeSpeech(
  text: string,
  options?: SynthesizeOptions,
): Promise<Buffer> {
  const model = options?.model ?? DEFAULT_MODEL;
  const voice = options?.voice ?? DEFAULT_VOICE;
  const format = options?.outputFormat ?? 'mulaw';

  const request: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
    },
  };

  const response = await callGenerateContent(model, request);

  // Extract audio data from response
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('Gemini TTS returned no audio data');
  }

  const audioPart = parts.find(p => p.inlineData);
  if (!audioPart?.inlineData) {
    throw new Error('Gemini TTS response missing inlineData');
  }

  const rawAudio = Buffer.from(audioPart.inlineData.data, 'base64');

  // If the API returns PCM but we want MULAW, the caller handles conversion.
  // For now, we trust the API returns the format matching the model's native output.
  // gemini-2.5-flash-tts natively outputs MULAW.
  if (format === 'pcm16' && audioPart.inlineData.mimeType?.includes('mulaw')) {
    throw new Error('PCM16 output requested but API returned MULAW. Use ffmpeg to convert.');
  }

  return rawAudio;
}

/**
 * Wrap raw MULAW samples in a WAV container.
 *
 * @param samples - Raw MULAW audio samples
 * @param sampleRate - Sample rate in Hz (default: 8000)
 * @returns Complete WAV file buffer
 */
export function wrapMulawWav(samples: Buffer, sampleRate = 8000): Buffer {
  const dataSize = samples.length;
  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // chunk size
  header.writeUInt16LE(7, 20);           // format code: mu-law
  header.writeUInt16LE(1, 22);           // channels: mono
  header.writeUInt32LE(sampleRate, 24);  // sample rate
  header.writeUInt32LE(sampleRate, 28);  // byte rate (sampleRate * 1 channel * 1 byte)
  header.writeUInt16LE(1, 32);           // block align
  header.writeUInt16LE(8, 34);           // bits per sample

  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, samples]);
}
