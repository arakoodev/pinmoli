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

  it('synthesizeSpeech calls Vertex AI and returns audio buffer', async () => {
    const fakeAudio = Buffer.from([0x80, 0x7F, 0x80, 0x7F]); // fake MULAW samples
    const fakeResponse = {
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'audio/basic',
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

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(4);
    expect(result[0]).toBe(0x80);

    // Verify the API was called with correct URL pattern
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('us-central1-aiplatform.googleapis.com');
    expect(url).toContain('test-project');
    expect(url).toContain('gemini-2.5-flash-tts');
    expect(url).toContain(':generateContent');

    // Verify request body
    const body = JSON.parse(options.body);
    expect(body.contents[0].parts[0].text).toBe('Hello world');
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });

  it('synthesizeSpeech accepts custom model and voice', async () => {
    const fakeAudio = Buffer.from([0x00]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/basic', data: fakeAudio.toString('base64') } }] } }],
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
