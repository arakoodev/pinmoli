# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules for Claude

1. **Be brutally honest about what was actually tested.** Unit tests that run locally are not the same as integration/live tests that hit real endpoints. Never present local-only tests as proof that a fix works against a remote service. State clearly: "unit tests passed (local only)" vs "live tests passed (hit LiveKit)".
2. **Failure is acceptable. Misrepresenting results is not.** If something doesn't work, say so. Don't spin partial results as success. Don't optimize for appearing successful — optimize for accuracy.
3. **When asked to run tests, run the actual tests.** Don't substitute a different test script and present it as equivalent. If TUI tests exist, run the TUI tests. If integration tests exist, run the integration tests. Don't write new ad-hoc scripts when existing test infrastructure already covers the case.
4. **Distinguish between "code compiles" and "feature works".** A clean build and passing unit tests prove correctness of isolated functions. They do not prove the feature works end-to-end against a real endpoint.
5. **EVERYTHING runs inside Docker. Non-negotiable.** Never run tests, builds, type-checks, or the TUI on the local laptop. The container has ffmpeg, espeak-ng, and other dependencies that don't exist locally. Running outside Docker gives misleading results. Use `docker compose exec` or `docker compose run` for ALL commands: `npm test`, `npx tsc --noEmit`, `npx tsx`, `node`, etc. If the container isn't running, start it with `docker compose up -d` first. There are zero exceptions to this rule.

## Project Overview

Pinmoli — "Postman for Voice". An AI-powered CLI for testing SIP and WebRTC voice endpoints. Point it at any SIP URI or WHIP endpoint, describe what you want to test in plain English, and Pinmoli handles the protocol details — INVITE flows, WHIP signaling, codec negotiation, RTP/SRTP streaming, failure analysis.

## Commands

**ALL commands run inside Docker. No exceptions.**

```bash
# Start the container
docker compose up -d

# Run the TUI interactively
docker compose exec pinmoli npx tsx src/cli.ts

# Type-check
docker compose exec pinmoli npx tsc --noEmit

# Run all tests
docker compose exec pinmoli npx vitest run

# Run unit tests only
docker compose exec pinmoli npx vitest run test/unit/

# Run integration tests only
docker compose exec pinmoli npx vitest run test/integration/

# Run live tests (hits real LiveKit endpoint)
docker compose exec pinmoli npx vitest run test/live/

# Lint
docker compose exec pinmoli npm run lint

# Rebuild container after Dockerfile or dependency changes
docker compose build && docker compose up -d
```

**Port 5060 conflict:** Only one process can bind port 5060. If running sip-engine directly while the dev server is up, kill the conflicting process first (`kill $(lsof -ti:5060)` inside the container).

## Architecture

### Docker stack (`docker-compose.yml`)
- **pinmoli**: Node.js 20 Alpine container with ffmpeg, espeak, tini. `network_mode: host` for SIP/RTP access.

### Source (`src/`)
- `cli.ts` — Entry point, CLI arg parsing, multi-provider auto-detection
- `agent/runtime.ts` — AI agent setup (pi-agent-core, multi-provider via pi-ai)
- `ui/tui.ts` — Terminal UI (pi-tui)
- `tools/` — 7 tool implementations (sip_test, webrtc_test, generate_audio, analyze_failure, save_test, load_test, list_tests)
- `sip/engine.ts` — SIP test orchestration (async generator, yields events)
- `sip/rtp-receiver.ts` — RTP packet build/parse/send/receive
- `sip/audio.ts` — Audio sample resolution
- `sip/sdp.ts` — SDP builder
- `sip/protocol.ts` — SIP utilities
- `webrtc/engine.ts` — WebRTC test orchestration (async generator, mirrors SIP engine)
- `webrtc/whip.ts` — WHIP signaling client (RFC 9725: HTTP POST offer → answer)
- `webrtc/audio-frames.ts` — PCM16 frame chunking + WAV save for WebRTC audio
- `storage/db.ts` — SQLite + FTS5 persistence
- `validation/schemas.ts` — Input validation (TypeBox + Zod)

### Tests (`test/`)
- `test/unit/` — Protocol, SDP, RTP, storage, validation, tools, eslint plugin, WebRTC WHIP, WebRTC engine
- `test/integration/` — TUI flows, end-to-end, bidirectional RTP, speech, generic SIP
- `test/live/` — Tests against real SIP and WebRTC endpoints (LiveKit)

## Lint Rules (`eslint-plugin-pinmoli`)

Custom ESLint plugin at `eslint-plugin-pinmoli.cjs` with 14 rules extracted from real bugs:

- **`pinmoli/no-console-in-lib`** — `console.*` in library code corrupts the TUI display
- **`pinmoli/no-process-exit`** — `process.exit()` skips SIP cleanup (no BYE, no socket close)
- **`pinmoli/no-shared-tmp-path`** — Hardcoded `/tmp/foo.ext` collides under concurrent tool execution
- **`pinmoli/no-unabortable-spawn`** — `spawn()` in tool `execute()` without abort signal handling leaves orphan processes
- **`pinmoli/no-unroutable-ip-fallback`** — `0.0.0.0` or `127.0.0.1` as IP fallback creates unroutable SDP/SIP headers
- **`pinmoli/no-random-sip-port`** — `Math.random()` for SIP port doesn't match Docker exposure
- **`pinmoli/no-unrefed-timer-in-sip`** — `setTimeout()` without `.unref()` keeps event loop alive after Ctrl+C
- **`pinmoli/require-to-tag-in-dialog`** — ACK/BYE builders must accept a `toTag` parameter (RFC 3261)
- **`pinmoli/no-setinterval-in-ui`** — `setInterval()` in UI code bypasses pi-tui's render pipeline. Use `Loader`/`CancellableLoader`
- **`pinmoli/require-cursor-hide-with-loader`** — `new Loader()` without `setShowHardwareCursor(false)` causes cursor flashing every 80ms render cycle
- **`pinmoli/no-hardcoded-payload-type`** — Literal `0`/`8`/`9`/`111` as RTP payload type bypasses codec negotiation. Use `codec.payloadType`
- **`pinmoli/no-optional-codec-in-media`** — Optional `codec?` parameter in media functions hides bugs. Callers silently get wrong PCMU defaults
- **`pinmoli/no-silent-transcode-fallback`** — Transcode functions must throw for unsupported codecs, not silently return input unchanged
- **`pinmoli/no-incomplete-enum-description`** — TypeBox `Type.Union` descriptions must mention all `Type.Literal` values. The LLM reads descriptions to determine valid inputs; missing values cause the LLM to reject valid options

Run `docker compose exec pinmoli npm run lint` before committing.

## Key Configuration

- `.env` — `LIVEKIT_ENDPOINT`, LLM provider env vars (`GOOGLE_APPLICATION_CREDENTIALS`, `ANTHROPIC_API_KEY`, etc.)
- `tsconfig.json` — TypeScript config
- `vitest.config.ts` — Test config
- `eslint.config.mjs` — ESLint flat config with pinmoli plugin

**Credentials are never baked into the Docker image.** GCP service account keys and other secrets are provided at runtime via environment variables, volume mounts, or CLI flags. See `.dockerignore` for excluded patterns.

## Critical SIP Patterns

1. **Always use `mergeCustomHeaders()`** — never spread `...customHeaders` after critical SIP fields
2. **ACK reuses INVITE CSeq** — do NOT increment cseqCounter before ACK (CSeq goes 1→1→2 for INVITE→ACK→BYE)
3. **Fixed SIP port** — always `port: 5060` (matches Docker exposure), never random
4. **SDP requires CRLF** — `\r\n`, not `\n`. Call `normalizeSdpLineEndings()` on user-provided SDP
5. **Guard socket cleanup** — use `let closed = false` flag before every `socket.close()`
6. **Never hardcode payload types** — use `codec.payloadType` from the negotiated `CodecInfo`, never literal `0`/`8`/`9`. Lint rule: `pinmoli/no-hardcoded-payload-type`
7. **Codec params are required in media functions** — `saveAsWAV`, `receiveRTPAudio`, `sendRTPFromSocket` all require explicit codec/acceptedPayloadTypes. Never default to PCMU. Lint rule: `pinmoli/no-optional-codec-in-media`
8. **Transcode must throw for unsupported codecs** — `transcodePcmuTo()` throws for codecs without an encoder (e.g. opus). Never silently return input unchanged. Lint rule: `pinmoli/no-silent-transcode-fallback`
9. **Schema descriptions must list all valid values** — TypeBox `Type.Union` descriptions are the primary way the LLM learns what a parameter accepts. If the description mentions only a subset, the LLM rejects the rest. Lint rule: `pinmoli/no-incomplete-enum-description`

## WebRTC / WHIP Architecture

The WebRTC engine (`src/webrtc/`) mirrors the SIP engine pattern:

- **Signaling**: WHIP (RFC 9725) — POST SDP offer to HTTP endpoint, get SDP answer. No vendor SDK needed.
- **Media**: `werift` — pure TypeScript WebRTC stack (ICE/DTLS/SRTP/RTP). No native bindings, works on Alpine.
- **Flow**: Create PeerConnection → Generate offer → WHIP POST → Set remote answer → ICE/DTLS connect → Send/receive audio → WHIP DELETE

### WHIP Pre-flight Rules
- WHIP endpoint must be HTTPS (or HTTP for local dev)
- Bearer token required for authenticated endpoints (LiveKit, Cloudflare)
- Default codec: opus (most WebRTC platforms prefer it)
- Default ICE server: `stun:stun.l.google.com:19302`

### WebRTC Error Codes
- `WHIP_HTTP_ERROR` — HTTP error from WHIP endpoint (bad URL, auth, etc.)
- `ICE_FAILED` — ICE connectivity failed (firewall/NAT). Try adding TURN server.
- `DTLS_FAILED` — DTLS handshake failed (cipher mismatch)
- `TIMEOUT` — Connection timeout. Voice agent may not be running.

## LiveKit SIP Troubleshooting

- **404 No trunk found**: Phone number doesn't match SIP trunk's allowed numbers
- **180 Ringing → 503 after 60s**: Agent not running, missing ACK, invalid IPs, or Docker container ID in Via
- **Via header with Docker container ID**: Missing `publicAddress` in `sip.start()`
- **The 503 is synthetic**: `sip` npm library generates it when TCP drops after 60s
- **SDP requires routable IP**: `0.0.0.0` or Docker IPs in SDP cause silent ICE failures
- **Codec negotiation**: LiveKit selects PCMU/8000 even when opus offered first. Always offer both.
