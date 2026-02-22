# Running Pinmoli in Docker

## Quick Start

```bash
# Build and run
docker-compose up

# Run tests
docker-compose run pinmoli npm test

# Run live tests
docker-compose run pinmoli npm test -- test/live/

# Run CLI
docker-compose run pinmoli node dist/cli.js

# Run demo
docker-compose run pinmoli npx tsx demo/sip-streaming.ts
```

## What's Included

The Docker image includes:
- Node.js 20 (Alpine)
- **ffmpeg** - for audio streaming (440Hz sine tone)
- All npm dependencies
- TypeScript build tools

## Network Mode

Uses `network_mode: host` to allow:
- UDP port 5060 (SIP signaling)
- UDP port 10000 (RTP media)
- Direct access to LiveKit endpoints

## Environment Variables

Set in `.env` at project root:
```env
ANTHROPIC_API_KEY=your-key
LIVEKIT_ENDPOINT=sip:+1234567890@5eezfwavhxe.sip.livekit.cloud
LIVEKIT_URL=wss://yamada-test-nklx8rpp.livekit.cloud
LIVEKIT_API_KEY=your-key
LIVEKIT_API_SECRET=your-secret
```

## Audio Streaming

When running INVITE tests, Pinmoli will:
1. Send INVITE with SDP
2. Receive 100 Processing, 180 Ringing, 200 OK
3. **Send ACK** to complete call setup
4. **Stream 3 seconds of 440Hz sine tone** via ffmpeg
5. **Send BYE** to hang up gracefully

Example output:
```
[INFO] Starting SIP INVITE test
[SIP] Received 100 Processing
[SIP] Received 180 Ringing
[SIP] Received 200 OK
[INFO] SDP answer received
[SIP] Sending ACK
[INFO] Streaming audio to 143.223.91.70:51939
[INFO] Audio stream complete (3s sine tone)
[SIP] Sending BYE
[SIP] Call terminated
```

## Development

```bash
# Watch mode (rebuilds on file changes)
docker-compose up

# Shell access
docker-compose run pinmoli sh

# Install new packages
docker-compose run pinmoli npm install <package>

# Rebuild after package changes
docker-compose build
```

## Volumes

- `.:/app` - Source code (live reload)
- `/app/node_modules` - Isolated dependencies
- `~/.pinmoli:/root/.pinmoli` - Persistent storage

## Why Docker?

- **ffmpeg included** - no need to install on host
- **Consistent environment** - same setup everywhere
- **Network isolation** - clean UDP port access
- **No host pollution** - all deps in container
