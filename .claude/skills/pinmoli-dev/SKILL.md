---
name: pinmoli-dev
description: Development guide for Pinmoli codebase. Use when modifying Pinmoli code, adding features, fixing bugs, or understanding the architecture. Project-specific skill for contributors.
user-invocable: false
---

# Pinmoli Development Guide

This skill provides context for AI assistants working on the Pinmoli codebase.

## Project Context

**What is Pinmoli?**
A specialized, domain-restricted AI agent for SIP/WebRTC testing. Think "Postman with Agent Mode" but exclusively for voice protocols. Multi-provider LLM support (Anthropic, OpenAI, Gemini, Groq, OpenRouter).

**Key Constraints:**
- Exactly 13 tools (sip_test, webrtc_test, generate_audio, analyze_failure, save_test, load_test, list_tests, replay_session, start_call, send_audio, receive_audio, end_call, play_audio)
- Domain-restricted to SIP/WebRTC testing only
- No file editing, no bash commands -- voice protocol testing only
- Built on pi-mono libraries (pi-agent-core, pi-ai, pi-tui)
- ALL commands run inside Docker (no exceptions)

## Architecture

```
TUI (src/cli.ts)
  |
  v
PinmoliTUI (src/ui/tui.ts) -- wraps pi-tui Terminal
  |
  v
Agent Runtime (src/agent/runtime.ts)
  - Multi-provider via pi-ai (Anthropic, OpenAI, Gemini, Groq, OpenRouter)
  - System prompt (domain restricted)
  |
  v
13 Tools (src/tools/)
  - sip_test      -- SIP INVITE/OPTIONS/REGISTER (one-shot)
  - webrtc_test   -- WebRTC via WHIP (RFC 9725)
  - start_call    -- Interactive SIP call (INVITE → 200 OK → ACK)
  - send_audio    -- Send audio on active call
  - receive_audio -- Listen for audio on active call
  - end_call      -- Hang up active call (BYE)
  - play_audio    -- Play WAV through speaker (ffmpeg → paplay/PulseAudio)
  - generate_audio -- ffmpeg/espeak audio generation
  - analyze_failure -- Pattern-matched diagnostics
  - replay_session -- Re-execute a recorded session's tool calls
  - save/load/list_tests -- lazy storage backend (SQLite preferred, JSON fallback)
  |
  v
SIP Engine (src/sip/)              WebRTC Engine (src/webrtc/)
  - engine.ts: async generator       - engine.ts: async generator
  - protocol.ts: SIP messages        - whip.ts: WHIP signaling
  - sdp.ts: SDP offer/answer         - audio-frames.ts: PCM16/OGG Opus/WAV
  - rtp-receiver.ts: RTP send/recv   - werift: pure TS WebRTC stack
  - codec.ts: codec table/transcode
  - dtmf.ts: RFC 4733 DTMF
  - audio.ts: sample resolution
  |
  v
Network (src/network/utils.ts) -- STUN NAT discovery, getLocalIp(), getPublicIp()
  |
  v
Storage (src/storage/db.ts) -- lazy storage backend (SQLite preferred, JSON fallback)
```

## File Structure

```
src/
├── cli.ts                    # Entry point, interactive TUI REPL
├── cli-pipe.ts               # Pipe mode (stdin→agent→stdout, stderr tee)
├── cli-replay.ts             # Replay mode (re-execute sessions without LLM)
├── cli-replay-snapshot.ts    # Replay interactive call snapshots (WAV-driven)
├── agent/runtime.ts          # PinmoliAgent wraps pi-agent-core
├── ui/
│   ├── tui.ts                # PinmoliTUI wraps pi-tui Terminal
│   ├── tool-output.ts        # Collapsible tool result rendering
│   └── test-terminal.ts      # Test-mode Terminal implementation
├── tools/
│   ├── registry.ts           # 12-tool allowlist enforcement
│   ├── index.ts              # Tool registration (TypeBox schemas)
│   ├── sip-test.ts           # SIP test execution (one-shot)
│   ├── webrtc-test.ts        # WebRTC test execution
│   ├── start-call.ts         # Interactive call: INVITE → 200 OK → ACK
│   ├── send-audio.ts         # Interactive call: send audio/DTMF
│   ├── receive-audio.ts      # Interactive call: listen for audio
│   ├── end-call.ts           # Interactive call: BYE + cleanup
│   ├── generate-audio.ts     # Audio generation (ffmpeg, espeak)
│   ├── analyze-failure.ts    # Diagnostic pattern matching
│   └── save/load/list-tests.ts
├── sip/
│   ├── engine.ts             # SIP test orchestration (async generator, delegates INVITE to call-session)
│   ├── call-session.ts       # Composable call phases: openDialog, sendAudio, receiveAudio, closeDialog
│   ├── call-store.ts         # In-memory CallHandle store (Map<callId, CallHandle>)
│   ├── protocol.ts           # SIP message building (OPTIONS, INVITE, ACK, BYE, CANCEL, REGISTER)
│   ├── sdp.ts                # SDP offer/answer builder + parseSdpAnswer()
│   ├── rtp-receiver.ts       # RTP/DTMF send/receive/save
│   ├── codec.ts              # CODEC_TABLE, transcoding (PCMU<->PCMA), lookup
│   ├── dtmf.ts               # RFC 4733 encode/decode, DtmfDetector
│   ├── audio.ts              # Audio sample resolution
│   └── replay-snapshot.ts    # Snapshot replay engine + ScenarioManifest types
├── webrtc/
│   ├── engine.ts             # WebRTC test orchestration (async generator)
│   ├── whip.ts               # WHIP signaling client (RFC 9725)
│   └── audio-frames.ts       # PCM16 frame chunking, OGG Opus decode, WAV save
├── google/
│   ├── auth.ts               # Google Cloud OAuth2 via service account JWT
│   ├── gemini-rest.ts        # Vertex AI generateContent REST client
│   └── tts.ts                # Gemini TTS (text→MULAW audio, zero transcoding for SIP)
├── network/
│   ├── utils.ts              # STUN NAT discovery, getLocalIp(), getPublicIp()
│   ├── session.ts            # Per-session directory, signaling log, metadata, manifest
│   └── flow.ts               # Flow recording from engine events, FlowRecord, compareFlows()
├── storage/db.ts             # Lazy storage init, SQLite preferred, JSON fallback
├── validation/schemas.ts     # TypeBox schemas
└── commands/service-account.ts
```

## Code Patterns

### 1. Async Generators for Streaming
```typescript
export async function* runSipTest(config): AsyncGenerator<SipEvent> {
  yield { type: 'info', message: 'Starting SIP test...' };
  yield { type: 'sip', status: 200, message: '200 OK' };
}
```

### 2. Required Parameters in Media Functions
Codec params are **required** (not optional) in media functions. This is enforced by lint rule `no-optional-codec-in-media`.
```typescript
// CORRECT: codec is required
export function saveAsWAV(audioData: Buffer[], outputPath: string, codec: CodecInfo): void
export function sendRTPFromSocket(socket, host, port, audioData, codec: CodecInfo): void

// WRONG: optional codec hides bugs
export function saveAsWAV(audioData: Buffer[], outputPath: string, codec?: CodecInfo): void
```

### 3. Loud Failure over Silent Corruption
Transcode functions must throw for unsupported codecs, not silently return input data.
```typescript
// CORRECT: throws for unsupported
throw new Error(`Codec ${codec.name} transcoding not implemented`);

// WRONG: silent identity return
return pcmuData;  // silently sends wrong codec
```

### 4. Codec Negotiation Flow
```
SDP offer (PCMU, PCMA, G722, opus) → 200 OK with SDP answer
→ parseSdpAnswer() extracts negotiated codec
→ transcodePcmuTo(audioData, negotiatedCodec) before sending
→ sendRTPFromSocket uses codec.payloadType, codec.packetSize
→ receiveRTPAudio filters by [codec.payloadType]
→ saveAsWAV uses codec.wavFormatCode, codec.sampleRate
```

### 5. STUN NAT Discovery for SDP
WSL2/Docker private IPs (172.19.x.x) are unreachable from the internet. Use STUN to discover the public IP:port before building SDP.
```typescript
import { stunDiscoverAddress } from '../network/utils.js';

// Discover public address through the ACTUAL RTP socket (not a separate one)
const { ip: publicIp, port: mappedPort } = await stunDiscoverAddress(rtpSocket);
// Use publicIp in SDP c= line AND SIP Via/Contact headers
const sdp = generateSdp(codecs, mappedPort, publicIp);
```
Falls back to `getLocalIp()` if STUN times out (3s). Available via `getPublicIp()` for one-off lookups (creates a temporary socket).

### 6. Send-Then-Listen Pattern
`responseWaitTime` counts from AFTER send completes, not concurrently. The agent may take 15-20s to process audio.
```typescript
// CORRECT: sequential — full listen window after send
await sendRTPFromSocket(socket, host, port, audioData, codec);
const received = await receiveRTPAudio(socket, responseWaitTime, [codec.payloadType]);

// WRONG: parallel — listen window overlaps with send, may miss response
await Promise.all([
  sendRTPFromSocket(socket, host, port, audioData, codec),
  receiveRTPAudio(socket, responseWaitTime, [codec.payloadType])
]);
```

### 7. Audio Capture to Session Directories
Received audio is saved to the per-test session directory as WAV files. For WebRTC with opus codec, the OGG Opus decode pipeline in `audio-frames.ts` converts received opus payloads to PCM16 before saving.

### 9. Flow Recording
Engine events are collected during tool execution and converted to a structured `FlowRecord` via `buildFlowFromEvents()`. The flow is written as `flow.json` alongside other session artifacts.
```typescript
import { buildFlowFromEvents, writeFlowJson } from '../network/flow.js';

// After engine async generator completes:
const flow = buildFlowFromEvents(collectedEvents, { protocol: 'sip', method: 'INVITE', uri });
writeFlowJson(session, flow);
```

### 8. Socket Cleanup Guards
```typescript
let socketClosed = false;
const closeSocket = () => {
  if (!socketClosed) {
    socketClosed = true;
    try { socket.close(); } catch (_) {}
  }
};
```

## Lint Rules (`eslint-plugin-pinmoli.cjs`)

### Protocol Correctness
- `no-unroutable-ip-fallback` -- 0.0.0.0/127.0.0.1 in SDP creates unroutable headers
- `no-random-sip-port` -- Math.random() for SIP port doesn't match Docker exposure
- `require-to-tag-in-dialog` -- ACK/BYE builders must accept toTag (RFC 3261)
- `no-hardcoded-payload-type` -- literal 0/8/9/111 in payloadType context; use codec.payloadType
- `no-optional-codec-in-media` -- codec? or codec = default in media functions
- `no-silent-transcode-fallback` -- transcode functions with identity fallback return

### SIP Transaction Correctness
- `require-cancel-with-invite` -- files that build INVITE requests must also handle CANCEL (RFC 3261 Section 9)

### Schema / LLM Correctness
- `no-incomplete-enum-description` -- Type.Union descriptions must mention all Literal values; the LLM reads descriptions to decide valid inputs

### Process Safety
- `no-console-in-lib` -- console.* in library code corrupts TUI display
- `no-process-exit` -- process.exit() skips SIP cleanup
- `no-shared-tmp-path` -- hardcoded /tmp/foo.ext collides under concurrency
- `no-unabortable-spawn` -- spawn() without abort signal handling leaves orphans
- `no-unrefed-timer-in-sip` -- setTimeout without .unref() keeps event loop alive
- `no-stun-on-sip-socket` -- SIP sockets use `;rport` for NAT traversal; STUN is for RTP/media sockets only
- `require-rport-in-via` -- Via headers must include `;rport` (RFC 3581) for reliable SIP NAT traversal
- `no-unguarded-post-close-write` -- wrap post-call artifact writes in their own try/catch so disk errors do not misreport successful calls as failed

### UI Rules
- `no-setinterval-in-ui` -- setInterval bypasses pi-tui's render pipeline
- `require-cursor-hide-with-loader` -- new Loader() without setShowHardwareCursor(false)

## Critical Rules

### DO
1. **Run everything in Docker** -- `docker compose exec pinmoli ...` for all commands
2. **Use codec from negotiation** -- never hardcode payload types
3. **Make media params required** -- codec, acceptedPayloadTypes, etc.
4. **Throw for unsupported codecs** -- no silent fallback
5. **Guard socket cleanup** -- boolean flags before close()
6. **Stream with async generators** -- for real-time events
7. **Use regex for SIP URIs** -- not URL()

### DON'T
1. **Don't create throwaway test scripts** -- use proper test infrastructure
2. **Don't change signatures without updating tests**
3. **Don't make codec/PT params optional** -- lint rule enforces this
4. **Don't return input data as transcode fallback** -- throw instead
5. **Don't hardcode PT=0** -- use codec.payloadType from negotiation
6. **Don't run commands outside Docker** -- container has ffmpeg, espeak, etc.

## Testing

```bash
# ALL commands run inside Docker
docker compose exec pinmoli npm test                    # unit + integration
docker compose exec pinmoli npx vitest run test/unit/    # unit only
docker compose exec pinmoli npx vitest run test/integration/  # integration
docker compose exec pinmoli npm run test:live            # live (real endpoints)
docker compose exec pinmoli npx tsc --noEmit             # type-check
docker compose exec pinmoli npm run lint                  # lint

# Replay a recorded session
docker compose exec pinmoli npx tsx src/cli-replay.ts captures/<session-id>
```

## Adding a New Codec

1. Add entry to `CODEC_TABLE` in `src/sip/codec.ts`
2. Add transcoding in `transcodePcmuTo()` (or throw with clear message)
3. Update `CodecSchema` in `src/validation/schemas.ts`
4. Add codec to `buildSdp()` in `src/sip/sdp.ts`
5. Add tests in `test/unit/codec.test.ts` and `test/unit/sdp.test.ts`
6. Update documentation (README.md, SKILLS.md)

## Packet Capture

Every session auto-captures SIP + RTP traffic via `tcpdump` in `entrypoint.sh`.

- Saves to `/app/captures/pinmoli-YYYYMMDD-HHMMSS.pcap`
- Fail-fast: exits if tcpdump missing, `/app/captures` not writable, or tcpdump can't start
- Warns if `/app/captures` is not volume-mounted (files lost on exit)
- Disable: `PINMOLI_NO_CAPTURE=1`
- For `docker run`: **all `-v` flags go BEFORE the image name**

## Dependencies

**Core:**
- `@mariozechner/pi-agent-core`: Agent runtime
- `@mariozechner/pi-ai`: Multi-provider LLM abstraction
- `@mariozechner/pi-tui`: Terminal UI with diff rendering
- `@sinclair/typebox`: Tool schemas (required by pi-agent-core)
- `better-sqlite3`: Storage
- `sip`: SIP protocol
- `werift`: Pure TypeScript WebRTC stack

**Dev:**
- `vitest`: Testing
- `typescript`: Type checking
- `eslint`: Linting with 17 custom rules
