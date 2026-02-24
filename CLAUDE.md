# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules for Claude

1. **Be brutally honest about what was actually tested.** Unit tests that run locally are not the same as integration/live tests that hit real endpoints. Never present local-only tests as proof that a fix works against a remote service. State clearly: "unit tests passed (local only)" vs "live tests passed (hit LiveKit)".
2. **Failure is acceptable. Misrepresenting results is not.** If something doesn't work, say so. Don't spin partial results as success. Don't optimize for appearing successful — optimize for accuracy.
3. **When asked to run tests, run the actual tests.** Don't substitute a different test script and present it as equivalent. If TUI tests exist, run the TUI tests. If integration tests exist, run the integration tests. Don't write new ad-hoc scripts when existing test infrastructure already covers the case.
4. **Distinguish between "code compiles" and "feature works".** A clean build and passing unit tests prove correctness of isolated functions. They do not prove the feature works end-to-end against a real endpoint.
5. **EVERYTHING runs inside Docker. Non-negotiable.** Never run tests, builds, type-checks, or the TUI on the local laptop. The container has ffmpeg, espeak-ng, and other dependencies that don't exist locally. Running outside Docker gives misleading results. Use `docker compose exec` or `docker compose run` for ALL commands: `npm test`, `npx tsc --noEmit`, `npx tsx`, `node`, etc. If the container isn't running, start it with `docker compose up -d` first. There are zero exceptions to this rule.

## Project Overview

Pinmoli — "Postman for Voice". An AI-powered CLI for testing SIP and WebRTC voice endpoints. Point it at any SIP URI, describe what you want to test in plain English, and Pinmoli handles the protocol details — INVITE flows, codec negotiation, RTP streaming, failure analysis.

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
- `cli.ts` — Entry point, TUI setup
- `agent/runtime.ts` — AI agent setup (pi-agent-core, Gemini backend)
- `ui/tui.ts` — Terminal UI (pi-tui)
- `tools/` — 6 tool implementations (sip_test, generate_audio, analyze_failure, save_test, load_test, list_tests)
- `sip/engine.ts` — SIP test orchestration (async generator, yields events)
- `sip/rtp-receiver.ts` — RTP packet build/parse/send/receive
- `sip/audio.ts` — Audio sample resolution
- `sip/sdp.ts` — SDP builder
- `sip/protocol.ts` — SIP utilities
- `storage/db.ts` — SQLite + FTS5 persistence
- `validation/schemas.ts` — Input validation (TypeBox + Zod)

### Tests (`test/`)
- `test/unit/` — Protocol, SDP, RTP, storage, validation, tools, eslint plugin
- `test/integration/` — TUI flows, end-to-end, bidirectional RTP, speech, generic SIP
- `test/live/` — Tests against real SIP endpoints (LiveKit)

## Lint Rules (`eslint-plugin-pinmoli`)

Custom ESLint plugin at `eslint-plugin-pinmoli.cjs` with 8 rules extracted from real bugs:

- **`pinmoli/no-sip-dialog`** — `sip.dialog()` does not exist in `sip` v0.0.6
- **`pinmoli/no-unroutable-sdp-ip`** — Flags `0.0.0.0` and `1.1.1.1` in strings
- **`pinmoli/no-literal-crlf-escape`** — Flags literal `\r\n` (4 chars) that should be actual CRLF
- **`pinmoli/require-public-address`** — `sip.start()` without `publicAddress` causes Via to contain Docker container ID
- **`pinmoli/no-local-ip-in-sip-uri`** — Flags `localIp` in `sip:` URI templates
- **`pinmoli/no-spread-in-sip-headers`** — Spread after critical SIP fields silently overwrites them
- **`pinmoli/no-sdp-lf-join`** — SDP joined with `'\n'` instead of `'\r\n'`
- **`pinmoli/no-random-sip-port`** — `Math.random()` for SIP port doesn't match Docker exposure

Run `docker compose exec pinmoli npm run lint` before committing.

## Key Configuration

- `.env` — `LIVEKIT_ENDPOINT`, GCP credentials
- `tsconfig.json` — TypeScript config
- `vitest.config.ts` — Test config
- `eslint.config.mjs` — ESLint flat config with pinmoli plugin

## Critical SIP Patterns

1. **Always use `mergeCustomHeaders()`** — never spread `...customHeaders` after critical SIP fields
2. **ACK reuses INVITE CSeq** — do NOT increment cseqCounter before ACK (CSeq goes 1→1→2 for INVITE→ACK→BYE)
3. **Fixed SIP port** — always `port: 5060` (matches Docker exposure), never random
4. **SDP requires CRLF** — `\r\n`, not `\n`. Call `normalizeSdpLineEndings()` on user-provided SDP
5. **Guard socket cleanup** — use `let closed = false` flag before every `socket.close()`

## LiveKit SIP Troubleshooting

- **404 No trunk found**: Phone number doesn't match SIP trunk's allowed numbers
- **180 Ringing → 503 after 60s**: Agent not running, missing ACK, invalid IPs, or Docker container ID in Via
- **Via header with Docker container ID**: Missing `publicAddress` in `sip.start()`
- **The 503 is synthetic**: `sip` npm library generates it when TCP drops after 60s
- **SDP requires routable IP**: `0.0.0.0` or Docker IPs in SDP cause silent ICE failures
- **Codec negotiation**: LiveKit selects PCMU/8000 even when opus offered first. Always offer both.
