import { describe, it, expect, afterEach } from 'vitest';
import { playAudioTool } from '../../src/tools/play-audio.js';

describe('play_audio tool', () => {
  const originalEnv = process.env.PULSE_SERVER;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PULSE_SERVER = originalEnv;
    } else {
      delete process.env.PULSE_SERVER;
    }
  });

  it('returns error when PULSE_SERVER is not set', async () => {
    delete process.env.PULSE_SERVER;
    const result = await playAudioTool.execute(
      'test-1',
      { filePath: 'voice-hello' },
      new AbortController().signal,
      () => {},
    );
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('PulseAudio');
    expect(text).toContain('./bin/pinmoli-play');
    expect(result.details).toMatchObject({ error: 'no_pulse_server' });
  });

  it('returns error when file does not exist', async () => {
    process.env.PULSE_SERVER = 'unix:/tmp/test-pulse';
    const result = await playAudioTool.execute(
      'test-2',
      { filePath: '/nonexistent/path/audio.wav' },
      new AbortController().signal,
      () => {},
    );
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Audio file not found');
  });

  it('resolves built-in sample names via getAudioSamplePath', async () => {
    process.env.PULSE_SERVER = 'unix:/tmp/test-pulse';
    // voice-hello exists as a built-in sample — the tool will find the file
    // but paplay will fail (no PulseAudio server). We verify it gets past
    // the file resolution step by checking the error is about playback, not file.
    const result = await playAudioTool.execute(
      'test-3',
      { filePath: 'voice-hello' },
      new AbortController().signal,
      () => {},
    );
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    // Should NOT say "file not found" — sample resolved successfully
    expect(text).not.toContain('Audio file not found');
  });

  it('has correct tool metadata', () => {
    expect(playAudioTool.name).toBe('play_audio');
    expect(playAudioTool.label).toBe('Play Audio');
    expect(playAudioTool.description).toContain('Play a WAV audio file');
    expect(playAudioTool.parameters).toBeDefined();
  });

  it('streams progress events via onUpdate', async () => {
    process.env.PULSE_SERVER = 'unix:/tmp/test-pulse';
    const updates: string[] = [];
    await playAudioTool.execute(
      'test-4',
      { filePath: 'voice-hello' },
      new AbortController().signal,
      (update) => {
        if (update?.content) {
          const text = (update.content as Array<{ type: string; text?: string }>)
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('');
          if (text) updates.push(text);
        }
      },
    );
    // Should have emitted at least a "Playing..." event
    expect(updates.some(u => u.includes('Playing'))).toBe(true);
  });
});
