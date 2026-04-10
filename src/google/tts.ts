/**
 * Gemini TTS — text-to-speech via Vertex AI generateContent.
 *
 * All current Gemini TTS models (gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts)
 * return audio as `audio/L16; codec=pcm; rate=24000` — signed 16-bit PCM, 24 kHz, mono.
 *
 * The previous implementation hardcoded mu-law 8 kHz and silently corrupted the output
 * (PCM16 bytes interpreted as mu-law, played at 8 kHz instead of 24 kHz → unintelligible
 * noise stretched to 6× the actual duration).
 */

import { callGenerateContent } from './gemini-rest.js';

/** Real Vertex AI model names. The legacy alias 'gemini-2.5-flash-tts' still works. */
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';
const DEFAULT_VOICE = 'Kore';

export interface SynthesizeOptions {
  /** Gemini model ID. Default: gemini-2.5-flash-preview-tts */
  model?: string;
  /** Voice name. Default: Kore */
  voice?: string;
}

export interface SynthesizeResult {
  /** Raw audio samples as returned by the API. */
  samples: Buffer;
  /** Sample rate in Hz, parsed from the response mime type. */
  sampleRate: number;
  /** Audio encoding ('pcm16' for L16/PCM, 'mulaw' if returned). */
  encoding: 'pcm16' | 'mulaw';
  /** Original mime type from the API for diagnostics. */
  mimeType: string;
}

/**
 * Parse a mime type like `audio/L16; codec=pcm; rate=24000` into rate + encoding.
 */
function parseAudioMime(mimeType: string): { sampleRate: number; encoding: 'pcm16' | 'mulaw' } {
  const lower = mimeType.toLowerCase();
  let encoding: 'pcm16' | 'mulaw' = 'pcm16';
  if (lower.includes('mulaw') || lower.includes('basic') || lower.includes('mu-law')) {
    encoding = 'mulaw';
  } else if (lower.includes('l16') || lower.includes('pcm')) {
    encoding = 'pcm16';
  }

  // Default rate by encoding (Gemini TTS defaults to 24kHz for L16)
  let sampleRate = encoding === 'mulaw' ? 8000 : 24000;
  const rateMatch = mimeType.match(/rate=(\d+)/i);
  if (rateMatch) sampleRate = parseInt(rateMatch[1], 10);

  return { sampleRate, encoding };
}

/**
 * Synthesize speech using Gemini TTS.
 *
 * @returns Audio samples + format metadata. Caller is responsible for wrapping
 *          in a WAV container and/or transcoding to the target SIP codec.
 */
export async function synthesizeSpeech(
  text: string,
  options?: SynthesizeOptions,
): Promise<SynthesizeResult> {
  const model = options?.model ?? DEFAULT_MODEL;
  const voice = options?.voice ?? DEFAULT_VOICE;

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

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('Gemini TTS returned no audio data');
  }

  const audioPart = parts.find(p => p.inlineData);
  if (!audioPart?.inlineData) {
    throw new Error('Gemini TTS response missing inlineData');
  }

  const samples = Buffer.from(audioPart.inlineData.data, 'base64');
  const mimeType = audioPart.inlineData.mimeType || 'audio/L16;codec=pcm;rate=24000';
  const { sampleRate, encoding } = parseAudioMime(mimeType);

  return { samples, sampleRate, encoding, mimeType };
}

/**
 * Wrap raw signed 16-bit little-endian PCM samples in a WAV container.
 *
 * Use for the typical Gemini TTS response (audio/L16, 24 kHz mono).
 */
export function wrapPcm16Wav(samples: Buffer, sampleRate = 24000): Buffer {
  const dataSize = samples.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);              // chunk size
  header.writeUInt16LE(1, 20);               // format code: PCM
  header.writeUInt16LE(1, 22);               // channels: mono
  header.writeUInt32LE(sampleRate, 24);      // sample rate
  header.writeUInt32LE(sampleRate * 2, 28);  // byte rate (16-bit = 2 bytes/sample × 1 channel)
  header.writeUInt16LE(2, 32);               // block align
  header.writeUInt16LE(16, 34);              // bits per sample

  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, samples]);
}

/**
 * Wrap raw MULAW samples in a WAV container.
 *
 * Kept for backward compatibility and the rare case where the API returns mu-law.
 */
export function wrapMulawWav(samples: Buffer, sampleRate = 8000): Buffer {
  const dataSize = samples.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(7, 20);           // format code: mu-law
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28);  // byte rate (8-bit = 1 byte/sample)
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);

  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, samples]);
}

/**
 * Wrap audio samples in the appropriate WAV container based on the encoding.
 */
export function wrapAudioAsWav(result: SynthesizeResult): Buffer {
  if (result.encoding === 'mulaw') {
    return wrapMulawWav(result.samples, result.sampleRate);
  }
  return wrapPcm16Wav(result.samples, result.sampleRate);
}
