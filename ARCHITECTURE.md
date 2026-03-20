# Pinmoli Architecture

Pinmoli is a domain-restricted AI agent for SIP/WebRTC voice testing, built on the [pi](https://github.com/badlogic/pi-mono) agent framework. The LLM orchestrates 7 voice-testing tools via natural language; the engines handle protocol details (SIP signaling, WebRTC WHIP, RTP/SRTP, codec negotiation). All output -- signaling logs, metadata, flow records, audio WAVs -- is scoped to per-session directories for replay and comparison.

## Pi Libraries

Pinmoli is built on [pi](https://github.com/badlogic/pi-mono), the same open-source agent framework that powers [OpenClaw](https://github.com/openclaw/openclaw). Where OpenClaw uses pi to build a general-purpose personal AI assistant (messaging gateway, file operations, shell commands across 50+ integrations), Pinmoli takes the opposite approach: a **domain-restricted agent** that does exactly one thing -- SIP/WebRTC testing -- and does it well.

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

| Package | Role in Pinmoli |
|---------|----------------|
| [`@mariozechner/pi-agent-core`](https://www.npmjs.com/package/@mariozechner/pi-agent-core) | Agent loop -- receives user input, calls LLM, executes tools, streams events back |
| [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai) | LLM provider abstraction -- swap between Gemini, Claude, GPT with one config change |
| [`@mariozechner/pi-tui`](https://www.npmjs.com/package/@mariozechner/pi-tui) | Terminal rendering -- differential updates, editor with autocomplete, flicker-free output |

## How the Pieces Connect

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
│  generate_audio ► ffmpeg/espeak/Gemini TTS                       │
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
│  ├─ audio-frames.ts ── PCM16 frames, OGG Opus builder, WAV save │
│  └─ werift ────── Pure TS WebRTC stack (ICE/DTLS/SRTP/RTP)      │
│                                                                  │
│  Yields events as they happen:                                   │
│    WHIP signaling, ICE/DTLS, RTP stats, DTMF, agent audio       │
└──────────────────────────────────────────────────────────────────┘
```

## Why Async Generators

The SIP engine is an `async function*` that yields events as they happen -- a SIP `100 Trying` at 12ms, a `200 OK` at 1200ms, RTP packet counts every second. The TUI renders each event the moment it arrives. No buffering, no callbacks, no polling.

```typescript
// The engine yields events in real time
for await (const event of runSipTest(config)) {
  tui.render(event);  // instant display
}
```

This design makes the engine usable outside the TUI too -- pipe events to NDJSON, feed them into a test assertion, stream them over a websocket, or record them into `flow.json` for replay.

## Why Domain Restriction

General-purpose agents (like OpenClaw) give the LLM access to bash, file I/O, and the full system. That power makes sense for a personal assistant. For a SIP testing tool, it's a liability -- you don't want an LLM accidentally `rm -rf`-ing your project while trying to debug a codec mismatch.

Pinmoli's agent can only call 7 tools, all voice-testing related. The system prompt explicitly forbids filesystem access, and the tool registry enforces the allowlist at runtime. The LLM stays in its lane.

## Source Structure

```
pinmoli/
├── src/
│   ├── cli.ts                  # Entry point, interactive TUI REPL
│   ├── cli-pipe.ts             # Pipe mode entry point (stdin→agent→stdout)
│   ├── cli-replay.ts           # Replay mode — re-execute sessions without LLM
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
│   │   ├── generate-audio.ts   # Audio generation (ffmpeg, espeak, Gemini TTS)
│   │   ├── analyze-failure.ts  # Diagnostic pattern matching
│   │   └── save/load/list-tests.ts
│   ├── sip/
│   │   ├── engine.ts           # SIP test orchestration (async generator)
│   │   ├── protocol.ts         # SIP message building
│   │   ├── sdp.ts              # SDP offer/answer builder
│   │   ├── rtp-receiver.ts     # RTP/DTMF packet send/receive
│   │   ├── codec.ts            # Codec table, transcoding (PCMU↔PCMA), lookup
│   │   ├── dtmf.ts             # RFC 4733 encode/decode, DtmfDetector
│   │   └── audio.ts            # Audio sample resolution
│   ├── webrtc/
│   │   ├── engine.ts           # WebRTC test orchestration (async generator)
│   │   ├── whip.ts             # WHIP signaling client (RFC 9725)
│   │   └── audio-frames.ts     # PCM16 frames, OGG Opus decode, WAV save
│   ├── google/
│   │   ├── auth.ts             # Google Cloud OAuth2 via service account JWT
│   │   ├── gemini-rest.ts      # Vertex AI generateContent REST client
│   │   └── tts.ts              # Gemini TTS (text→MULAW audio)
│   ├── network/
│   │   ├── utils.ts            # STUN NAT discovery, getLocalIp(), getPublicIp()
│   │   ├── session.ts          # Per-session directory, signaling log, metadata, manifest
│   │   └── flow.ts             # Flow recording from engine events, FlowRecord type
│   ├── storage/db.ts           # SQLite + FTS5 persistence
│   ├── validation/schemas.ts   # TypeBox schemas
│   └── commands/service-account.ts
├── audio-samples/              # Pre-generated PCMU WAV files
├── test/
│   ├── unit/                   # Protocol, SDP, RTP, DTMF, storage, tools, lint, WebRTC, flow
│   ├── integration/            # TUI flows, e2e, bidirectional RTP, speech
│   └── live/                   # Tests against real SIP and WebRTC endpoints
├── eslint-plugin-pinmoli.cjs   # 15 lint rules from real bugs
├── Dockerfile                  # Alpine + Node 20 + ffmpeg + espeak + tcpdump + tini
├── docker-compose.yml
└── entrypoint.sh
```

## Engine Event Flow

Both engines (SIP and WebRTC) yield `TestEvent` objects as async generators. The tool layer collects these events, forwards them to the TUI for real-time display, and records them for post-run analysis:

```
Engine (async generator)
  │
  │  yields TestEvent { type, message, timestamp, status?, method? }
  │
  ▼
Tool (sip_test / webrtc_test)
  │
  ├──► TUI: onUpdate() — real-time rendering
  ├──► events[]: collected for analyze_failure
  ├──► session.logSignaling() — appends to sip-log.txt / signaling-log.txt
  └──► buildFlowFromEvents() — writes flow.json
        │
        ▼
      FlowRecord { protocol, method, uri, messages[], audioFiles, rtpStats }
        │
        ├──► flow.json — structured, machine-readable
        └──► cli-replay.ts — compareFlows(original, replay)
```

The `flow.json` is a structured representation of the signaling flow: each message with its direction (`sent`/`received`/`info`), offset in milliseconds, and method or status code. This replaces the need to parse `sip-log.txt` for automated comparisons.

## Session & Replay Architecture

### CLI Session

Each Pinmoli invocation (TUI, pipe, or replay) creates a top-level session directory:

```
captures/{session-id}/           # e.g. 20260320-065054-tw1x
├── manifest.json                # SessionManifest: tool calls, params, timing
├── audio-samples/               # Generated audio (scoped to this session)
├── sip-invite-host-ts/          # Per-test directory (Session object)
│   ├── sip-log.txt
│   ├── metadata.json
│   ├── flow.json
│   └── *.wav
└── webrtc-whip-host-ts/
    ├── signaling-log.txt
    ├── metadata.json
    ├── flow.json
    └── *.wav
```

`initCliSession()` creates the root, `createSession()` creates per-test subdirectories.

### Manifest

`manifest.json` records every tool call the LLM made during the session:

```typescript
interface SessionManifest {
  version: number;
  sessionId: string;
  startTime: string;
  provider?: string;     // LLM provider that drove this session
  model?: string;
  steps: ToolCallRecord[];
}

interface ToolCallRecord {
  seq: number;
  tool: string;          // e.g. "sip_test", "generate_audio"
  params: Record<string, unknown>;
  timestamp: string;
  durationMs: number;
  success: boolean;
  testDir?: string;      // per-test subdirectory name
}
```

Auth passwords are redacted (`***`) before recording.

### Replay

`cli-replay.ts` reads `manifest.json`, loads `flow.json` from each test directory, re-executes each tool call with the same parameters, and compares:

1. **Sequence match** -- did the signaling messages follow the same order?
2. **Timing delta** -- how much faster/slower was the replay?
3. **RTP comparison** -- packets sent/received counts
4. **Codec match** -- did the remote select the same codec?

Replay creates its own session directory under `captures/` with fresh `flow.json` files.

## Google Cloud Auth

The `src/google/` module provides zero-dependency Google Cloud authentication for Vertex AI:

```
Service account JSON (/app/secrets/gcp-service-account.json)
  │
  ▼
auth.ts — loadServiceAccount(), getAccessToken()
  │  JWT: RS256 sign with private_key
  │  POST https://oauth2.googleapis.com/token
  │  Caches token until 5min before expiry
  │
  ▼
gemini-rest.ts — callVertexAI(endpoint, body)
  │  POST https://{location}-aiplatform.googleapis.com/v1/...
  │  Shared by TTS and future STT
  │
  ▼
tts.ts — synthesizeSpeech(text) → Uint8Array (raw MULAW samples)
  │  Uses gemini-2.5-flash-tts model
  │  Returns 8kHz MULAW — zero transcoding for SIP (PCMU)
  │  wrapMulawWav() adds WAV container headers
  │
  ▼
generate-audio.ts — ttsProvider: 'gemini' branch
  │  For PCMU: direct WAV save (no ffmpeg)
  │  For PCMA/G722: ffmpeg converts from MULAW WAV
```

Key design choice: Gemini TTS returns raw MULAW (8kHz, 8-bit, u-law) which is the native SIP codec (PCMU). This means zero transcoding for the most common SIP path.

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

# Lint (15 custom rules)
docker compose exec pinmoli npm run lint
```

### Test categories

- **Unit tests** (`test/unit/`) -- protocol building, SDP parsing, RTP, DTMF, codec table, storage, validation, tools, lint rules, WebRTC WHIP, flow recording
- **Integration tests** (`test/integration/`) -- TUI flows, end-to-end agent interaction, bidirectional RTP, speech generation, generic SIP
- **Live tests** (`test/live/`) -- hit real SIP and WebRTC endpoints (LiveKit). Require network and `LIVEKIT_ENDPOINT`.

## Lint Rules

15 custom rules in `eslint-plugin-pinmoli.cjs`, all extracted from real bugs:

### Protocol Correctness
- `no-unroutable-ip-fallback` -- 0.0.0.0/127.0.0.1 in SDP
- `no-random-sip-port` -- Math.random() for SIP port
- `require-to-tag-in-dialog` -- ACK/BYE must accept toTag (RFC 3261)
- `no-hardcoded-payload-type` -- literal 0/8/9/111 as RTP payload type
- `no-optional-codec-in-media` -- optional codec params hide bugs
- `no-silent-transcode-fallback` -- must throw for unsupported codecs
- `require-cancel-with-invite` -- CANCEL for unanswered INVITEs (RFC 3261 Section 9)

### Schema / LLM Correctness
- `no-incomplete-enum-description` -- Type.Union descriptions must list all values

### Process Safety
- `no-console-in-lib` -- console.* corrupts TUI display
- `no-process-exit` -- skips SIP cleanup
- `no-shared-tmp-path` -- /tmp collisions under concurrency
- `no-unabortable-spawn` -- orphan processes without abort signal
- `no-unrefed-timer-in-sip` -- event loop kept alive after Ctrl+C

### UI Rules
- `no-setinterval-in-ui` -- bypasses pi-tui render pipeline
- `require-cursor-hide-with-loader` -- cursor flashing without setShowHardwareCursor(false)
