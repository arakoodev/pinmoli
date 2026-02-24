# Audio Samples for SIP Testing

This directory contains pre-generated audio samples for SIP call testing.

## Samples Included

All samples are:
- **Format**: WAV (PCM μ-law)
- **Sample Rate**: 8000 Hz
- **Channels**: Mono
- **Duration**: 3-5 seconds
- **License**: Public Domain / CC0

### Available Samples

1. **sine-440hz.wav** - 440Hz sine tone (3s)
2. **sine-1000hz.wav** - 1000Hz sine tone (3s)
3. **dtmf-123.wav** - DTMF tones for digits 1-2-3 (3s)
4. **voice-hello.wav** - Synthesized "Hello, this is a test call" (5s)
5. **silence.wav** - Silence (3s)

## Generation

These samples are generated using ffmpeg at build time:

```bash
# Sine tones
ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -acodec pcm_mulaw -ar 8000 -ac 1 sine-440hz.wav
ffmpeg -f lavfi -i "sine=frequency=1000:duration=3" -acodec pcm_mulaw -ar 8000 -ac 1 sine-1000hz.wav

# DTMF tones
ffmpeg -f lavfi -i "sine=frequency=697:duration=0.3,sine=frequency=1209:duration=0.3" -acodec pcm_mulaw -ar 8000 -ac 1 dtmf-1.wav
# (combine for 1-2-3)

# Silence
ffmpeg -f lavfi -i "anullsrc=duration=3" -acodec pcm_mulaw -ar 8000 -ac 1 silence.wav
```

## Usage in Tests

```typescript
import { streamAudioFile } from '../sip/audio.js';

// Stream a sample
await streamAudioFile('sine-440hz.wav', remoteIp, remotePort);
```

## License

All samples are either:
- Generated synthetically (sine waves, DTMF, silence) - Public Domain
- Text-to-speech synthesized - Public Domain

No copyrighted material is included.
