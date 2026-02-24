#!/bin/sh
set -e

# Smart init: generate audio samples if missing
if [ ! -f /app/audio-samples/sine-440hz.wav ]; then
  echo "First run — generating audio samples..."
  sh generate-audio-samples.sh
fi

# Hand off to tini (PID 1: signal forwarding + zombie reaping)
# Always run the CLI — any docker run args are passed as CLI flags
exec /sbin/tini -- npx tsx src/cli.ts "$@"
