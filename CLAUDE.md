# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Postman for Voice" — a general-purpose developer workspace for testing, debugging, and building real-time voice applications. Provides a web UI for SIP signaling (INVITE, REGISTER, OPTIONS), real-time diagnostic logging via Socket.io, SDP inspection, and audio injection/RTP streaming against any SIP platform (LiveKit, Daily.co, Twilio, Asterisk, etc.).

## Commands

All SIP/voice test commands **must** run inside the Docker container (requires ffmpeg, espeak-ng, sipp, drachtio-srf).

```bash
# Start the full stack (frontend + drachtio SIP server)
docker compose up

# Unit tests (Vitest, runs inside container)
docker compose exec frontend npm test

# Full agent media test (INVITE → audio stream → capture response)
docker compose exec frontend node test-agent.mjs

# Individual SIP test scripts
docker compose exec frontend node test-sip.mjs        # OPTIONS ping
docker compose exec frontend node test-rtp.mjs         # RTP media
docker compose exec frontend node scan-extensions.mjs  # Extension discovery

# Frontend-only (from frontend/ directory, but prefer Docker)
npm run dev      # Dev server with Socket.io (node server.js)
npm run build    # Next.js production build
npm run lint     # ESLint (includes SIP correctness rules)
npm test         # Vitest
```

## Architecture

### Two-service Docker stack (`docker-compose.yml`)
- **drachtio**: SIP signaling server on port 5060 (UDP/TCP), bridges WebRTC ↔ SIP
- **frontend**: Next.js app on port 3000, also exposes port 5060 (SIP) and 10000 (UDP/RTP)

### Frontend (`frontend/`)
- **Next.js 16 + React 19** with App Router (`src/app/`)
- **Single-page workspace** in `src/app/page.tsx` — composes components: Sidebar, SipTimeline, SdpDiff, DiagnosticInsights, HeaderEditor, CodecPicker, AudioControls, PresetSelector
- **Real-time logging**: `server.js` creates HTTP server → `server.mjs` attaches Socket.io → on `start-test` event, spawns `sip-engine.mjs` with parameterized config and streams structured JSON events back to UI
- **Styling**: Tailwind CSS 4, clsx + tailwind-merge for conditional classes

### SIP Engine (`frontend/src/lib/sip-engine.mjs`)
Unified parameterized SIP test runner. Accepts `{method, uri, headers, sdp, audio}` as base64 JSON arg. Handles OPTIONS, REGISTER, INVITE flows. Outputs structured JSON events to stdout:
- SIP message events (direction, status, headers, SDP)
- Diagnostic events (detected protocol issues)
- Info events (state transitions, codec negotiation, media stats)

### UI Components (`frontend/src/components/`)
- `SipTimeline.tsx` — Visual SIP message timeline with expandable details
- `SdpDiff.tsx` — Side-by-side offer/answer SDP comparison
- `DiagnosticInsights.tsx` — Auto-detected protocol issues
- `HeaderEditor.tsx` — Key-value SIP header editor
- `CodecPicker.tsx` — Codec selection + raw SDP editor
- `AudioControls.tsx` — Audio source configuration (silence/tone/TTS/file)
- `PresetSelector.tsx` — Platform preset dropdown
- `Sidebar.tsx` — Collections & history browser

### Libraries (`frontend/src/lib/`)
- `sip-engine.mjs` — Unified SIP test runner (spawned as child process)
- `presets.ts` — Platform preset definitions (LiveKit, Daily, Twilio, Asterisk, Generic)
- `collections.ts` — Save/load collections and history (localStorage)

### Tests (`frontend/src/app/*.test.*`)
- **Vitest** with jsdom environment and React Testing Library
- `page.test.tsx`: React component rendering (5 tests)
- `livekit.test.ts`: SIP OPTIONS connectivity (10s timeout)
- `livekit-media.test.ts`: Full INVITE + media negotiation + RTP (20s timeout)

## SIP Lint Rules (`eslint-plugin-sip`)

Custom ESLint plugin at `frontend/eslint-plugin-sip.mjs` with 9 rules applied to `test-*.mjs`, `src/**/*.test.ts`, and `src/lib/sip-engine.mjs`:

### Protocol Correctness
- **`sip/no-sip-dialog`** (error) — `sip.dialog()` does not exist in `sip` v0.0.6. Manually construct ACK/BYE from INVITE transaction headers.
- **`sip/no-unroutable-sdp-ip`** (error) — Flags `0.0.0.0` and `1.1.1.1` in strings. Use `os.networkInterfaces()` to detect a real IP.
- **`sip/no-literal-crlf-escape`** (error) — Flags literal `\r\n` (4 chars) that should be actual CRLF. Use `'\r\n'` not `'\\r\\n'`.
- **`sip/require-allow-in-invite`** (warn) — INVITE without `Allow` header. RFC 3261 Section 20.5 SHOULD.

### Docker / NAT Awareness
- **`sip/require-public-address`** (error) — `sip.start()` without `publicAddress` causes Via header to contain Docker container ID. Always pass `{ publicAddress: publicIp }`.
- **`sip/no-local-ip-in-sip-uri`** (error) — Flags `localIp` in `sip:` URI templates. Docker private IPs in Contact/From headers are unreachable.

### Code Quality (SIP-specific)
- **`sip/no-spread-in-sip-headers`** (error) — Spread elements (`...customHeaders`) after critical SIP header fields can silently overwrite `to`, `from`, `call-id`, `cseq`, `contact`, `via`. Use `mergeCustomHeaders()` or put the spread BEFORE critical fields.
- **`sip/no-sdp-lf-join`** (error) — SDP arrays joined with `'\n'` instead of `'\r\n'`. SDP requires CRLF per RFC 4566.
- **`sip/no-random-sip-port`** (error) — `Math.random()` for SIP port assignment produces ports that don't match Docker port exposure. Contact header advertises an unreachable port. Use a fixed port.

Run `npm run lint` (or `docker compose exec frontend npm run lint`) before committing SIP test changes.

## Key Configuration

- `.env` — `LIVEKIT_ENDPOINT=sip:<id>.sip.livekit.cloud` (target SIP trunk)
- `frontend/tsconfig.json` — path alias `@/*` → `./src/*`
- `frontend/vitest.config.ts` — jsdom environment, React plugin, `@/` alias
- `frontend/eslint.config.mjs` — ESLint flat config with Next.js + SIP plugin

## Critical SIP Patterns

When writing SIP code in this project, follow these patterns (all enforced by lint rules):

1. **Always use `mergeCustomHeaders()`** to add custom headers — never spread `...customHeaders` after critical SIP fields
2. **ACK reuses INVITE CSeq** — do NOT increment cseqCounter before ACK. Increment once before BYE (CSeq goes 1→1→2 for INVITE→ACK→BYE)
3. **Fixed SIP port** — always `port: 5060` (matches Docker exposure), never random
4. **Normalize custom SDP to CRLF** — browser textareas give `\n`, SDP requires `\r\n`. Call `normalizeSdpLineEndings()` on user-provided SDP
5. **Avoid stale closures in React** — when Socket.io handlers need current state, use refs (`eventsRef.current`) not the state variable directly

## LiveKit SIP Troubleshooting

- **180 Ringing → 503 after 60s**: Multiple possible causes — (1) AI agent worker not running, (2) test framework failing to send ACK after 200 OK, (3) invalid IPs or malformed SDP, (4) Docker container ID in Via header. Check lint output and framework logs first, then agent deployment.
- **Via header with Docker container ID**: `sip.start()` without `publicAddress` uses `os.hostname()` which returns the Docker container ID (e.g. `6a2d87fd27fc`). Fix: always pass `publicAddress: publicIp`. Lint rule: `sip/require-public-address`.
- **Docker private IP in Contact/From**: Using `localIp` (e.g. `172.20.0.3`) in Contact/From headers makes them unroutable. Use `publicIp` instead. Lint rule: `sip/no-local-ip-in-sip-uri`.
- **The 503 is synthetic**: When LiveKit drops the TCP connection after 60s (agent timeout), the `sip` npm library generates a synthetic 503 internally. This is NOT a real SIP 503 from LiveKit.
- **SDP requires routable IP**: `0.0.0.0` or private Docker IPs in SDP `o=`/`c=` lines cause silent ICE failures. Test scripts fetch public IP via `ifconfig.me`.
- **Codec requirements**: Always offer opus (PT 111) alongside PCMU (G.711) in SDP.
- **SDP line endings**: Must use actual CRLF (`\r\n`), not escaped `\\r\\n`. Lint rule: `sip/no-literal-crlf-escape`.
- **Custom header safety**: Never `...spread` user headers after critical SIP fields — use `mergeCustomHeaders()` which filters reserved keys. Lint rule: `sip/no-spread-in-sip-headers`.
