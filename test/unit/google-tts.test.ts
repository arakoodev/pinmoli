import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the auth and REST modules before importing tts
vi.mock('../../src/google/auth.js', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-token'),
  resetAuthCache: vi.fn(),
}));

describe('Gemini TTS', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
  });

  it('synthesizeSpeech parses PCM L16 24kHz response from real Gemini TTS', async () => {
    const fakeAudio = Buffer.from([0x12, 0x34, 0x56, 0x78]); // fake PCM16 samples
    const fakeResponse = {
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'audio/L16;codec=pcm;rate=24000',
              data: fakeAudio.toString('base64'),
            },
          }],
        },
      }],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse,
    });
    globalThis.fetch = mockFetch;

    const { synthesizeSpeech } = await import('../../src/google/tts.js');
    const result = await synthesizeSpeech('Hello world');

    expect(result.samples).toBeInstanceOf(Buffer);
    expect(result.samples.length).toBe(4);
    expect(result.samples[0]).toBe(0x12);
    expect(result.sampleRate).toBe(24000);
    expect(result.encoding).toBe('pcm16');
    expect(result.mimeType).toBe('audio/L16;codec=pcm;rate=24000');

    // Verify the API was called with correct URL pattern
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('us-central1-aiplatform.googleapis.com');
    expect(url).toContain('test-project');
    expect(url).toContain('gemini-2.5-flash-preview-tts');
    expect(url).toContain(':generateContent');

    // Verify request body
    const body = JSON.parse(options.body);
    expect(body.contents[0].parts[0].text).toBe('Hello world');
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });

  it('synthesizeSpeech detects mu-law from audio/basic mime type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/basic', data: Buffer.from([0x80]).toString('base64') } }] } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const { synthesizeSpeech } = await import('../../src/google/tts.js');
    const result = await synthesizeSpeech('Hello');
    expect(result.encoding).toBe('mulaw');
    expect(result.sampleRate).toBe(8000);
  });

  it('synthesizeSpeech parses custom rate from mime type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=16000', data: Buffer.from([0x00, 0x01]).toString('base64') } }] } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const { synthesizeSpeech } = await import('../../src/google/tts.js');
    const result = await synthesizeSpeech('Hello');
    expect(result.sampleRate).toBe(16000);
    expect(result.encoding).toBe('pcm16');
  });

  it('synthesizeSpeech accepts custom model and voice', async () => {
    const fakeAudio = Buffer.from([0x00, 0x01]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: fakeAudio.toString('base64') } }] } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const { synthesizeSpeech } = await import('../../src/google/tts.js');
    await synthesizeSpeech('Test', { model: 'gemini-custom-tts', voice: 'Puck' });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('gemini-custom-tts');
    const body = JSON.parse(options.body);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
  });

  it('throws when response has no audio data', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'no audio' }] } }] }),
    });
    globalThis.fetch = mockFetch;

    const { synthesizeSpeech } = await import('../../src/google/tts.js');
    await expect(synthesizeSpeech('Hello')).rejects.toThrow('missing inlineData');
  });

  it('throws when response has no candidates', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),
    });
    globalThis.fetch = mockFetch;

    const { synthesizeSpeech } = await import('../../src/google/tts.js');
    await expect(synthesizeSpeech('Hello')).rejects.toThrow('no audio data');
  });
});

describe('wrapMulawWav', () => {
  it('produces valid WAV header for MULAW samples', async () => {
    const { wrapMulawWav } = await import('../../src/google/tts.js');
    const samples = Buffer.from([0x80, 0x7F, 0x80, 0x7F, 0x80, 0x7F, 0x80, 0x7F]);
    const wav = wrapMulawWav(samples);

    // WAV = 44 byte header + data
    expect(wav.length).toBe(44 + 8);

    // RIFF header
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + 8); // file size - 8
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    // fmt chunk
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16);    // chunk size
    expect(wav.readUInt16LE(20)).toBe(7);     // mu-law format
    expect(wav.readUInt16LE(22)).toBe(1);     // mono
    expect(wav.readUInt32LE(24)).toBe(8000);  // sample rate
    expect(wav.readUInt32LE(28)).toBe(8000);  // byte rate
    expect(wav.readUInt16LE(32)).toBe(1);     // block align
    expect(wav.readUInt16LE(34)).toBe(8);     // bits per sample

    // data chunk
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(8);     // data size

    // Audio data follows header
    expect(wav[44]).toBe(0x80);
    expect(wav[45]).toBe(0x7F);
  });

  it('handles empty samples', async () => {
    const { wrapMulawWav } = await import('../../src/google/tts.js');
    const wav = wrapMulawWav(Buffer.alloc(0));
    expect(wav.length).toBe(44);
    expect(wav.readUInt32LE(40)).toBe(0);
  });

  it('accepts custom sample rate', async () => {
    const { wrapMulawWav } = await import('../../src/google/tts.js');
    const wav = wrapMulawWav(Buffer.from([0x80]), 16000);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(16000);
  });
});

describe('wrapPcm16Wav', () => {
  it('produces valid WAV header for PCM16 24kHz samples', async () => {
    const { wrapPcm16Wav } = await import('../../src/google/tts.js');
    const samples = Buffer.from([0x12, 0x34, 0x56, 0x78]); // 2 PCM16 samples
    const wav = wrapPcm16Wav(samples);

    expect(wav.length).toBe(44 + 4);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1);     // PCM format code
    expect(wav.readUInt16LE(22)).toBe(1);     // mono
    expect(wav.readUInt32LE(24)).toBe(24000); // default sample rate
    expect(wav.readUInt32LE(28)).toBe(48000); // byte rate (24000 × 2)
    expect(wav.readUInt16LE(32)).toBe(2);     // block align (16-bit mono)
    expect(wav.readUInt16LE(34)).toBe(16);    // bits per sample
    expect(wav.readUInt32LE(40)).toBe(4);     // data size

    expect(wav[44]).toBe(0x12);
    expect(wav[47]).toBe(0x78);
  });

  it('accepts custom sample rate', async () => {
    const { wrapPcm16Wav } = await import('../../src/google/tts.js');
    const wav = wrapPcm16Wav(Buffer.from([0x00, 0x01]), 16000);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(32000); // 16000 × 2 bytes/sample
  });
});

describe('wrapAudioAsWav', () => {
  it('wraps PCM16 result as PCM WAV', async () => {
    const { wrapAudioAsWav } = await import('../../src/google/tts.js');
    const wav = wrapAudioAsWav({
      samples: Buffer.from([0x12, 0x34]),
      sampleRate: 24000,
      encoding: 'pcm16',
      mimeType: 'audio/L16;codec=pcm;rate=24000',
    });
    expect(wav.readUInt16LE(20)).toBe(1);  // PCM format
    expect(wav.readUInt32LE(24)).toBe(24000);
  });

  it('wraps mu-law result as mu-law WAV', async () => {
    const { wrapAudioAsWav } = await import('../../src/google/tts.js');
    const wav = wrapAudioAsWav({
      samples: Buffer.from([0x80]),
      sampleRate: 8000,
      encoding: 'mulaw',
      mimeType: 'audio/basic',
    });
    expect(wav.readUInt16LE(20)).toBe(7);  // mu-law format
    expect(wav.readUInt32LE(24)).toBe(8000);
  });
});

describe('callGenerateContent auth paths', () => {
  let originalFetch3: typeof globalThis.fetch;
  let originalApiKey: string | undefined;
  let originalProject: string | undefined;

  beforeEach(() => {
    originalFetch3 = globalThis.fetch;
    originalApiKey = process.env.GEMINI_API_KEY;
    originalProject = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch3;
    if (originalApiKey !== undefined) process.env.GEMINI_API_KEY = originalApiKey;
    else delete process.env.GEMINI_API_KEY;
    if (originalProject !== undefined) process.env.GOOGLE_CLOUD_PROJECT = originalProject;
    else delete process.env.GOOGLE_CLOUD_PROJECT;
  });

  it('uses generativelanguage.googleapis.com when GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'test-api-key-123';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
    globalThis.fetch = mockFetch;

    const { callGenerateContent } = await import('../../src/google/gemini-rest.js');
    await callGenerateContent('test-model', { contents: [] });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('key=test-api-key-123');
    expect(url).not.toContain('aiplatform.googleapis.com');
  });

  it('uses aiplatform.googleapis.com when only Vertex AI is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
    globalThis.fetch = mockFetch;

    const { callGenerateContent } = await import('../../src/google/gemini-rest.js');
    await callGenerateContent('test-model', { contents: [] });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('aiplatform.googleapis.com');
    expect(url).toContain('test-project');
    expect(options.headers.Authorization).toContain('Bearer');
  });

  it('prefers API key over Vertex AI when both are set', async () => {
    process.env.GEMINI_API_KEY = 'api-key-wins';
    process.env.GOOGLE_CLOUD_PROJECT = 'vertex-project';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
    globalThis.fetch = mockFetch;

    const { callGenerateContent } = await import('../../src/google/gemini-rest.js');
    await callGenerateContent('test-model', { contents: [] });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('key=api-key-wins');
  });
});

describe('synthesize → wrap integration (prevents the 6× noise bug)', () => {
  let originalFetch2: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch2 = globalThis.fetch;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch2;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
  });

  it('PCM L16 24kHz from Gemini is wrapped as PCM WAV, not mu-law', async () => {
    // Simulate the exact Gemini TTS response format
    const fakePcm16 = Buffer.alloc(480); // 10ms of PCM16 24kHz mono
    for (let i = 0; i < 240; i++) {
      fakePcm16.writeInt16LE(Math.round(Math.sin(i * 0.1) * 10000), i * 2);
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'audio/L16;codec=pcm;rate=24000',
                data: fakePcm16.toString('base64'),
              },
            }],
          },
        }],
      }),
    });
    globalThis.fetch = mockFetch;

    const { synthesizeSpeech, wrapAudioAsWav } = await import('../../src/google/tts.js');
    const result = await synthesizeSpeech('Test');
    const wav = wrapAudioAsWav(result);

    // WAV header must say PCM (format 1), NOT mu-law (format 7)
    expect(wav.readUInt16LE(20)).toBe(1);     // PCM format code
    expect(wav.readUInt16LE(20)).not.toBe(7); // NOT mu-law

    // Sample rate must be 24000, NOT 8000
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(24)).not.toBe(8000);

    // Bits per sample: 16, not 8
    expect(wav.readUInt16LE(34)).toBe(16);

    // Block align: 2 (16-bit mono), not 1 (8-bit)
    expect(wav.readUInt16LE(32)).toBe(2);

    // Data bytes should be the original PCM16 bytes, not re-encoded
    expect(wav.subarray(44).length).toBe(fakePcm16.length);
    expect(wav.subarray(44).equals(fakePcm16)).toBe(true);

    // Duration: 480 bytes / (24000 × 2 bytes/sample) = 0.01s
    const durationSec = wav.readUInt32LE(40) / (24000 * 2);
    expect(durationSec).toBeCloseTo(0.01, 2);
  });
});
