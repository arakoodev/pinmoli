#!/bin/sh
set -e

echo "Generating audio samples for SIP testing..."

SAMPLES_DIR="audio-samples"
mkdir -p "$SAMPLES_DIR"

# 440Hz sine tone (3s)
echo "  - sine-440hz.wav"
ffmpeg -f lavfi -i "sine=frequency=440:duration=3" \
  -acodec pcm_mulaw -ar 8000 -ac 1 -y \
  "$SAMPLES_DIR/sine-440hz.wav" 2>/dev/null

# 1000Hz sine tone (3s)
echo "  - sine-1000hz.wav"
ffmpeg -f lavfi -i "sine=frequency=1000:duration=3" \
  -acodec pcm_mulaw -ar 8000 -ac 1 -y \
  "$SAMPLES_DIR/sine-1000hz.wav" 2>/dev/null

# DTMF tone (simple 697Hz for 1.5s)
echo "  - dtmf-123.wav"
ffmpeg -f lavfi -i "sine=frequency=697:duration=1.5" \
  -acodec pcm_mulaw -ar 8000 -ac 1 -y \
  "$SAMPLES_DIR/dtmf-123.wav" 2>/dev/null

# Silence (3s)
echo "  - silence.wav"
ffmpeg -f lavfi -i "anullsrc=duration=3" \
  -acodec pcm_mulaw -ar 8000 -ac 1 -y \
  "$SAMPLES_DIR/silence.wav" 2>/dev/null

# Voice sample using espeak (if available)
if command -v espeak >/dev/null 2>&1; then
  echo "  - voice-hello.wav"
  espeak "Hello, this is a test call from Pinmoli" -w /tmp/voice.wav 2>/dev/null
  ffmpeg -i /tmp/voice.wav -acodec pcm_mulaw -ar 8000 -ac 1 -y \
    "$SAMPLES_DIR/voice-hello.wav" 2>/dev/null
  rm /tmp/voice.wav
else
  echo "  - voice-hello.wav (skipped - espeak not available)"
  # Use a longer sine tone as fallback
  ffmpeg -f lavfi -i "sine=frequency=440:duration=5" \
    -acodec pcm_mulaw -ar 8000 -ac 1 -y \
    "$SAMPLES_DIR/voice-hello.wav" 2>/dev/null
fi

echo "✓ Audio samples generated in $SAMPLES_DIR/"
