# Pinmoli

*From Tamil பின்மொழி (pin mozhi) -- "afterword"*

An AI-powered CLI for testing SIP and WebRTC voice endpoints. Describe what you want to test in plain English, and Pinmoli handles the protocol details -- INVITE flows, codec negotiation, RTP streaming, failure analysis.

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

- **Natural language interface** -- describe tests in plain English, the AI agent translates to protocol operations
- **Full SIP call flows** -- OPTIONS pings, INVITE with SDP offer/answer, REGISTER with auth, ACK, BYE
- **WebRTC via WHIP** -- connect to any WHIP endpoint (LiveKit, Cloudflare, Janus), negotiate ICE/DTLS/SRTP, send and receive audio
- **Bidirectional RTP audio** -- send pre-generated or custom speech, receive and measure agent responses
- **DTMF send and receive (RFC 4733)** -- send telephone-event RTP packets during active calls, detect incoming DTMF from the remote side
- **Runtime speech synthesis** -- generate custom TTS audio on the fly with espeak
- **Failure analysis** -- pattern-matched diagnostics with actionable recovery steps
- **Test persistence** -- save and reload test configurations (SQLite with FTS5)
- **Works with any SIP or WebRTC endpoint** -- LiveKit, Daily.co, Twilio, Cloudflare, Asterisk, FreeSWITCH, or any RFC 3261/WHIP-compliant server
- **Runs in Docker** -- all dependencies (ffmpeg, espeak, tini) included, no local setup required

## Architecture

Pinmoli is built on [pi](https://github.com/badlogic/pi-mono), the same open-source agent framework that powers [OpenClaw](https://github.com/openclaw/openclaw). Where OpenClaw uses pi to build a general-purpose personal AI assistant (messaging gateway, file operations, shell commands across 50+ integrations), Pinmoli takes the opposite approach: a **domain-restricted agent** that does exactly one thing -- SIP/WebRTC testing -- and does it well.

The key difference is scope. OpenClaw embeds `pi-coding-agent` to give an LLM full access to read, write, edit, and bash tools across an entire system. Pinmoli uses only `pi-agent-core` and `pi-ai` with a locked-down tool allowlist of 7 voice-testing tools. The LLM cannot touch the filesystem, run shell commands, or do anything outside voice protocol testing.

### Pi libraries

```
pi-ai                              pi-tui
Multi-provider LLM abstraction     Terminal UI with diff rendering
Anthropic, OpenAI, Google,         Editor, Markdown, Box, Text
Bedrock, Mistral, Groq, ...       Keyboard input, layout engine
         │                                   │
         ▼                                   ▼
pi-agent-core                      Pinmoli TUI (src/ui/tui.ts)
Agent loop, tool execution,        Wraps pi-tui for interactive mode
event subscription, AbortSignal    Falls back to raw Terminal for tests
         │
         ▼
PinmoliAgent (src/agent/runtime.ts)
Domain-restricted system prompt
7-tool allowlist, event routing
```

Pinmoli uses three pi packages:

| Package | Role in Pinmoli |
|---------|----------------|
| [`@mariozechner/pi-agent-core`](https://www.npmjs.com/package/@mariozechner/pi-agent-core) | Agent loop -- receives user input, calls LLM, executes tools, streams events back |
| [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai) | LLM provider abstraction -- swap between Gemini, Claude, GPT with one config change |
| [`@mariozechner/pi-tui`](https://www.npmjs.com/package/@mariozechner/pi-tui) | Terminal rendering -- differential updates, editor with autocomplete, flicker-free output |

### How the pieces connect

```
User input
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│  TUI  (src/ui/tui.ts)                                           │
│  pi-tui Editor → reads input → sends to agent                   │
│  Agent events → streamed back → rendered in real time            │
│  Ctrl+C: abort current operation / clear input / quit            │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Agent  (src/agent/runtime.ts)                                   │
│  pi-agent-core Agent with pi-ai model                            │
│                                                                  │
│  System prompt constrains LLM to SIP testing only:               │
│  "You are Pinmoli, a SIP/WebRTC testing assistant.               │
│   You ONLY help test voice protocols.                            │
│   You CANNOT edit files, run bash, or access the filesystem."    │
│                                                                  │
│  Tool allowlist enforced by registry (src/tools/registry.ts):    │
│  sip_test, webrtc_test, generate_audio, analyze_failure,         │
│  save_test, load_test, list_tests                                │
└──────────────────────┬───────────────────────────────────────────┘
                       │  LLM decides which tool to call
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Tools  (src/tools/*.ts)                                         │
│                                                                  │
│  sip_test ─────► SIP Engine (async generator, streams events)    │
│  webrtc_test ──► WebRTC Engine (WHIP signaling, werift stack)    │
│  generate_audio ► ffmpeg/espeak (sine, DTMF, silence, speech)    │
│  analyze_failure ► Pattern matching on event history             │
│  save/load/list ► SQLite with FTS5 (src/storage/db.ts)           │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  SIP Engine  (src/sip/engine.ts)                                 │
│                                                                  │
│  async function* runSipTest(config): AsyncGenerator<SipEvent>    │
│                                                                  │
│  ┌─ protocol.ts ── SIP message builder (INVITE, ACK, BYE)       │
│  ├─ sdp.ts ─────── SDP offer/answer (opus, PCMU, PCMA, G722)    │
│  ├─ rtp-receiver.ts ── RTP/DTMF send/receive on UDP socket      │
│  ├─ dtmf.ts ───── RFC 4733 encode/decode, DtmfDetector          │
│  └─ audio.ts ───── Sample resolution (WAV files, generated)      │
│                                                                  │
│  Yields events as they happen:                                   │
│    SIP messages, RTP stats, DTMF, diagnostics, codec negotiation │
└──────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  WebRTC Engine  (src/webrtc/engine.ts)                           │
│                                                                  │
│  async function* runWebRtcTest(config): AsyncGenerator<TestEvent>│
│                                                                  │
│  ┌─ whip.ts ───── WHIP signaling (RFC 9725: POST offer→answer)  │
│  ├─ audio-frames.ts ── PCM16 frame chunking + WAV save           │
│  └─ werift ────── Pure TS WebRTC stack (ICE/DTLS/SRTP/RTP)      │
│                                                                  │
│  Yields events as they happen:                                   │
│    WHIP signaling, ICE/DTLS, RTP stats, DTMF, agent audio       │
└──────────────────────────────────────────────────────────────────┘
```

### Why async generators

The SIP engine is an `async function*` that yields events as they happen -- a SIP `100 Trying` at 12ms, a `200 OK` at 1200ms, RTP packet counts every second. The TUI renders each event the moment it arrives. No buffering, no callbacks, no polling.

```typescript
// The engine yields events in real time
for await (const event of runSipTest(config)) {
  tui.render(event);  // instant display
}
```

This design makes the engine usable outside the TUI too -- pipe events to NDJSON, feed them into a test assertion, or stream them over a websocket.

### Why domain restriction matters

General-purpose agents (like OpenClaw) give the LLM access to bash, file I/O, and the full system. That power makes sense for a personal assistant. For a SIP testing tool, it's a liability -- you don't want an LLM accidentally `rm -rf`-ing your project while trying to debug a codec mismatch.

Pinmoli's agent can only call 7 tools, all voice-testing related. The system prompt explicitly forbids filesystem access, and the tool registry enforces the allowlist at runtime. The LLM stays in its lane.

## Quick Start

### Prerequisites

- Docker
- An LLM provider credential (GCP service account key for Gemini, or an API key for Anthropic/OpenAI)

### Quick Start (GHCR)

Pull the published image and run:

```bash
docker pull ghcr.io/arakoodev/pinmoli:latest
```

**GCP service account (Gemini):**

```bash
docker run --rm -it --network host \
  -v /path/to/your-key.json:/credentials.json:ro \
  ghcr.io/arakoodev/pinmoli --service-account /credentials.json
```

**Anthropic API key:**

```bash
docker run --rm -it --network host \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/arakoodev/pinmoli
```

**OpenAI API key:**

```bash
docker run --rm -it --network host \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/arakoodev/pinmoli
```

The image is published automatically on every push to `main` via [GitHub Actions](./.github/workflows/docker-publish.yml). Tagged releases (`v*`) produce versioned images (e.g., `ghcr.io/arakoodev/pinmoli:0.2.0`).

### Development

For contributors building from source:

```bash
git clone git@github.com:arakoodev/pinmoli.git
cd pinmoli
docker compose build
docker compose up -d

# Start the TUI
docker compose exec pinmoli npx tsx src/cli.ts

# With a GCP service account
docker compose exec pinmoli npx tsx src/cli.ts \
  --service-account /app/secrets/my-key.json
```

The source directory is bind-mounted, so code changes are reflected immediately.

### Try it

You're in. Type a test request:

```
You: Send OPTIONS to sip:trunk.example.com
You: INVITE sip:+15551234567@sip.livekit.cloud with opus and PCMU
You: Generate speech saying "What is the weather today?" then call the agent
```

### Run without the AI agent

If you just want to run SIP tests programmatically without the conversational TUI:

```bash
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

Pinmoli defaults to **Google Vertex AI (Gemini 2.5 Flash)** via pi-ai. Since pi-ai supports 20+ providers, you can swap the backend with a config change:

| Provider | Config value | Credentials |
|----------|-------------|-------------|
| Google Vertex AI | `google-vertex` (default) | Service account JSON (volume-mounted) or `GOOGLE_APPLICATION_CREDENTIALS` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` env var |
| OpenAI | `openai` | `OPENAI_API_KEY` env var |

Set credentials at startup:

```bash
# docker run -- mount credentials and pass via CLI flag
docker run --rm -it --network host \
  -v /path/to/key.json:/credentials.json:ro \
  ghcr.io/arakoodev/pinmoli --service-account /credentials.json

# docker compose -- pass flag via exec
docker compose exec pinmoli npx tsx src/cli.ts \
  --service-account /app/secrets/my-key.json

# Or via the TUI slash command (if the file is already mounted)
/service-account /app/secrets/my-key.json
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

Pinmoli exposes 7 tools to the AI agent. You don't call these directly -- you describe what you want and the agent picks the right tool. See [SKILLS.md](./SKILLS.md) for full parameter reference.

| Tool | Purpose |
|------|---------|
| `sip_test` | Run OPTIONS, INVITE, or REGISTER against a SIP endpoint. Supports DTMF send/receive via `dtmfDigits`. |
| `webrtc_test` | Connect to a WHIP endpoint, negotiate ICE/DTLS/SRTP, send audio, capture agent response. Supports DTMF. |
| `generate_audio` | Create custom audio samples (sine, DTMF dual-tone, silence, TTS speech) |
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

## Project Structure

```
pinmoli/
├── src/
│   ├── cli.ts                  # Entry point, REPL loop
│   ├── agent/runtime.ts        # PinmoliAgent wraps pi-agent-core
│   ├── ui/
│   │   ├── tui.ts              # PinmoliTUI wraps pi-tui
│   │   ├── tool-output.ts      # Collapsible tool result rendering
│   │   └── test-terminal.ts    # Test-mode Terminal implementation
│   ├── tools/
│   │   ├── registry.ts         # 7-tool allowlist enforcement
│   │   ├── index.ts            # Tool registration
│   │   ├── sip-test.ts         # SIP test execution (async generator)
│   │   ├── webrtc-test.ts      # WebRTC test execution (WHIP + werift)
│   │   ├── generate-audio.ts   # Audio generation (ffmpeg, espeak)
│   │   ├── analyze-failure.ts  # Diagnostic pattern matching
│   │   └── save/load/list-tests.ts
│   ├── sip/
│   │   ├── engine.ts           # SIP test orchestration (async generator)
│   │   ├── protocol.ts         # SIP message building
│   │   ├── sdp.ts              # SDP offer/answer builder
│   │   ├── rtp-receiver.ts     # RTP/DTMF packet send/receive
│   │   ├── dtmf.ts             # RFC 4733 encode/decode, DtmfDetector
│   │   └── audio.ts            # Audio sample resolution
│   ├── webrtc/
│   │   ├── engine.ts           # WebRTC test orchestration (async generator)
│   │   ├── whip.ts             # WHIP signaling client (RFC 9725)
│   │   └── audio-frames.ts     # PCM16 frame chunking + WAV save
│   ├── storage/db.ts           # SQLite + FTS5 persistence
│   ├── validation/schemas.ts   # TypeBox schemas
│   └── commands/service-account.ts
├── audio-samples/              # Pre-generated PCMU WAV files
├── test/
│   ├── unit/                   # Protocol, SDP, RTP, DTMF, storage, tools, lint, WebRTC
│   ├── integration/            # TUI flows, e2e, bidirectional RTP, speech
│   └── live/                   # Tests against real SIP and WebRTC endpoints
├── eslint-plugin-pinmoli.cjs   # 10 lint rules from real bugs
├── Dockerfile                  # Alpine + Node 20 + ffmpeg + espeak + tini
├── docker-compose.yml
└── entrypoint.sh
```

## Testing

All tests run inside Docker.

```bash
# Start the container
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
# If using a volume-mounted service account, verify it's accessible inside the container
docker compose exec pinmoli ls -la /app/secrets/my-key.json

# Or pass credentials via environment variable
docker run --rm -it --network host \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/arakoodev/pinmoli
```

## Contributing

```bash
# Fork and clone
git clone https://github.com/your-fork/pinmoli.git
cd pinmoli

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
