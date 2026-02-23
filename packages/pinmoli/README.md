# Pinmoli

*From Tamil பிபின்மொழி (pipin mozhi) -- "afterword"*

An AI-powered CLI for testing SIP and WebRTC voice endpoints. Point it at any SIP URI, describe what you want to test in plain English, and Pinmoli handles the protocol details -- INVITE flows, codec negotiation, RTP streaming, failure analysis.

Think "Postman for Voice", but conversational.

```
$ pinmoli

  Pinmoli - SIP/WebRTC Testing Agent

You: Test sip:+15551234567@trunk.example.com with INVITE, wait 15 seconds for a response

Pinmoli: Running INVITE test against sip:+15551234567@trunk.example.com...

  [sip_test] INVITE sip:+15551234567@trunk.example.com
  ├─ 100 Trying (12ms)
  ├─ 180 Ringing (45ms)
  ├─ 200 OK (1203ms) — codec: PCMU/8000
  ├─ ACK sent
  ├─ RTP: sent 150 packets (voice-hello, 3.0s)
  ├─ RTP: waiting 15s for agent response...
  ├─ RTP: received 1247 packets (15.0s)
  └─ BYE sent, 200 OK

  Call completed successfully. The agent answered after 1.2s and spoke for
  the full 15-second window. Codec negotiated: PCMU/8000 (G.711 u-law).
```

## Features

- **Natural language interface** -- describe tests in plain English, the AI agent translates to SIP protocol operations
- **Full SIP call flows** -- OPTIONS pings, INVITE with SDP offer/answer, REGISTER with auth, ACK, BYE
- **Bidirectional RTP audio** -- send pre-generated or custom speech, receive and measure agent responses
- **Runtime speech synthesis** -- generate custom TTS audio on the fly with espeak
- **Failure analysis** -- pattern-matched diagnostics with actionable recovery steps
- **Test persistence** -- save and reload test configurations (SQLite with FTS5)
- **Works with any SIP endpoint** -- LiveKit, Daily.co, Twilio, Asterisk, FreeSWITCH, or any RFC 3261-compliant server
- **Runs in Docker** -- all dependencies (ffmpeg, espeak, tini) included, no local setup required

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A GCP service account key (for the default Gemini LLM backend)

### 1. Clone and configure

```bash
git clone https://github.com/nishirlabs/pinmoli.git
cd pinmoli/packages/pinmoli

# Place your GCP service account key
cp /path/to/your-key.json gcp-service-account.json
```

### 2. Build and run

```bash
docker compose up -d --build
docker compose exec pinmoli npx tsx src/cli.ts
```

You're in. Type a test request:

```
You: Send OPTIONS to sip:trunk.example.com
You: INVITE sip:+15551234567@sip.livekit.cloud with opus and PCMU
You: Generate speech saying "What is the weather today?" then call the agent
```

### 3. Run without the AI agent

If you just want to run SIP tests programmatically without the conversational TUI:

```bash
# OPTIONS ping
docker compose exec pinmoli npx tsx -e "
  import { runSipTest } from './src/sip/engine.js';
  for await (const event of runSipTest({
    uri: 'sip:trunk.example.com',
    method: 'OPTIONS',
    codecs: ['PCMU']
  })) { console.log(JSON.stringify(event)); }
"
```

## Configuration

### LLM Provider

Pinmoli defaults to **Google Vertex AI (Gemini 2.5 Flash)**. The provider is configured in `src/cli.ts` and supports multiple backends:

| Provider | Config value | Credentials |
|----------|-------------|-------------|
| Google Vertex AI | `google-vertex` (default) | `gcp-service-account.json` or `GOOGLE_APPLICATION_CREDENTIALS` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` env var |
| OpenAI | `openai` | `OPENAI_API_KEY` env var |

Set credentials at startup:

```bash
# Via CLI flag
docker compose exec pinmoli npx tsx src/cli.ts --service-account /app/gcp-service-account.json

# Or via the TUI slash command
/service-account /path/to/key.json
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account JSON |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | GCP region (default: `us-central1`) |

### Docker Compose

The default `docker-compose.yml` uses `network_mode: host` so SIP and RTP traffic reaches the network directly. Modify if your setup requires bridged networking with explicit port mapping.

## Tools

Pinmoli exposes 6 tools to the AI agent. You don't call these directly -- you describe what you want and the agent picks the right tool. See [SKILLS.md](./SKILLS.md) for full parameter reference.

| Tool | Purpose |
|------|---------|
| `sip_test` | Run OPTIONS, INVITE, or REGISTER against a SIP endpoint |
| `generate_audio` | Create custom audio samples (sine, DTMF, silence, TTS speech) |
| `analyze_failure` | Diagnose a failed test and suggest fixes |
| `save_test` | Save a test configuration by name |
| `load_test` | Reload and run a saved test |
| `list_tests` | List all saved test configurations |

## Audio Samples

### Pre-generated (included in the Docker image)

| Sample | Description | Duration |
|--------|-------------|----------|
| `voice-hello` | "Hello, this is a test call from Pinmoli" | ~3s |
| `sine-440hz` | 440 Hz sine wave | 3s |
| `sine-1000hz` | 1000 Hz sine wave | 3s |
| `dtmf-123` | DTMF tones 1-2-3 | 1.5s |
| `silence` | Silence | 3s |

All samples are PCMU @ 8kHz mono (G.711 u-law), the standard SIP codec.

### Runtime generation

Ask the agent to generate custom speech:

```
You: Generate speech saying "Please transfer me to billing"
You: Now call sip:+15551234567@trunk.example.com with that audio
```

Or generate tones:

```
You: Generate a 1000Hz sine wave for 5 seconds, then test the endpoint
```

## Architecture

```
┌──────────────────────────────────────┐
│  TUI (pi-tui)                        │
│  Terminal UI with streaming output    │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│  AI Agent (pi-agent-core)            │
│  LLM-driven tool orchestration       │
│  Streams events to TUI in real time  │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│  6 Tools                             │
│  sip_test, generate_audio,           │
│  analyze_failure, save/load/list     │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│  SIP Engine                          │
│  UDP transport, SDP builder,         │
│  RTP send/receive (single socket)    │
└──────────────────────────────────────┘
```

### Key design decisions

- **Single RTP socket**: Send and receive on the same UDP socket so the remote peer responds to the correct port. Previous ffmpeg-based transport used an ephemeral port that didn't match the SDP advertisement.
- **Async generators**: The SIP engine yields events as they happen (`async function*`), enabling real-time streaming to the TUI.
- **Network-aware headers**: SIP Via/Contact headers use the detected network IP (via `os.networkInterfaces()`), not `0.0.0.0` or Docker-internal addresses.

## Project Structure

```
packages/pinmoli/
├── src/
│   ├── cli.ts                  # Entry point
│   ├── agent/runtime.ts        # AI agent setup (pi-agent-core)
│   ├── ui/tui.ts               # Terminal UI (pi-tui)
│   ├── tools/                  # 6 tool implementations
│   ├── sip/
│   │   ├── engine.ts           # SIP test orchestration
│   │   ├── rtp-receiver.ts     # RTP packet build/parse/send/receive
│   │   ├── audio.ts            # Audio sample resolution
│   │   ├── sdp.ts              # SDP builder
│   │   ├── transport.ts        # UDP transport
│   │   └── protocol.ts         # SIP utilities
│   ├── storage/db.ts           # SQLite persistence
│   ├── validation/schemas.ts   # Input validation (TypeBox)
│   └── system-prompt.ts        # Agent system prompt
├── audio-samples/              # Pre-generated PCMU WAV files
├── test/
│   ├── unit/                   # Protocol, SDP, RTP, storage, validation
│   ├── integration/            # TUI flows, end-to-end, bidirectional RTP
│   └── live/                   # Tests against real SIP endpoints
├── generate-audio-samples.sh   # Regenerate WAV files (ffmpeg + espeak)
├── Dockerfile                  # Alpine + ffmpeg + espeak + tini
├── docker-compose.yml
└── entrypoint.sh
```

## Testing

All tests run inside Docker.

```bash
# Start the container
cd packages/pinmoli
docker compose up -d

# Run all tests
docker compose exec pinmoli npx vitest run

# Unit tests only (~1s)
docker compose exec pinmoli npx vitest run test/unit/

# Integration tests
docker compose exec pinmoli npx vitest run test/integration/

# Live tests (hits real SIP endpoints, requires network)
docker compose exec pinmoli npx vitest run test/live/

# Type-check
docker compose exec pinmoli npx tsc --noEmit

# Lint
docker compose exec pinmoli npm run lint
```

## Troubleshooting

### Port 5060 already in use

Only one process can bind the SIP port. Kill the conflicting process inside the container:

```bash
docker compose exec pinmoli sh -c 'kill $(lsof -ti:5060)'
```

### No RTP packets received

1. **NAT/firewall** -- the host must be reachable on the RTP port advertised in SDP. Private IPs (WSL2 `172.x`, Docker `172.x`) are not routable from the internet.
2. **No agent running** -- the remote SIP endpoint accepted the call but has no worker to generate audio.
3. Run from a host with a public IP or use Docker with `network_mode: host`.

### 503 Service Unavailable after 60s

This is usually a synthetic 503 generated by the `sip` npm library when the remote drops the TCP connection (e.g., LiveKit agent timeout). It's not a real SIP 503. Common causes:
- AI agent worker not running on the remote side
- Malformed SDP or unroutable IPs in headers
- Missing ACK after 200 OK

### LLM not responding

Check that your credentials are configured:

```bash
# Verify the service account file exists in the container
docker compose exec pinmoli ls -la /app/gcp-service-account.json

# Or set via environment
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
```

## Contributing

```bash
# Fork and clone
git clone https://github.com/your-fork/pinmoli.git
cd pinmoli/packages/pinmoli

# Build the container
docker compose build

# Run tests (must pass before submitting a PR)
docker compose up -d
docker compose exec pinmoli npx vitest run
docker compose exec pinmoli npx tsc --noEmit
docker compose exec pinmoli npm run lint
```

All commands run inside Docker -- the container includes ffmpeg, espeak, and other dependencies that aren't available locally.

## License

MIT
