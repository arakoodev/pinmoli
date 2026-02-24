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
    pattern: '^[0-9*#]+$',
    description: 'DTMF digits to generate (0-9, *, #)' 
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
    setTimeout(() => { ffmpeg.kill(); resolve(false); }, 10000);
  });
}

async function generateDTMF(output: string, digits: string, duration: number): Promise<boolean> {
  // Simplified: just use a tone for now
  const freq = 697; // DTMF low frequency
  return generateSine(output, freq, duration);
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
    setTimeout(() => { ffmpeg.kill(); resolve(false); }, 10000);
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
    setTimeout(() => { espeak.kill(); resolve(false); }, 10000);
  });
}
