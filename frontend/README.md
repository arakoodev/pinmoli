# Postman for Voice

General-purpose developer workspace for testing, debugging, and building real-time voice applications. Provides a web UI for SIP signaling (INVITE, REGISTER, OPTIONS), real-time diagnostic logging, SDP inspection, and audio injection/RTP streaming against any SIP platform.

## Quick Start

```bash
# Start the full stack (frontend + drachtio SIP server)
docker compose up

# Open http://localhost:3000
```

### CLI Mode (no UI)

Run the SIP engine directly from the command line — useful for scripting or CI:

```bash
# Encode params as base64 JSON
PARAMS=$(echo '{"method":"INVITE","uri":"sip:+1234567890@ID.sip.livekit.cloud","transport":"auto","headers":{},"codecs":["opus","PCMU"],"customSdp":null,"audio":{"source":"tone","frequency":440,"duration":5}}' | base64 -w 0)

# Run inside Docker
docker compose exec frontend node src/lib/sip-engine.mjs "$PARAMS"
```

Output is newline-delimited JSON — pipe to `jq` for filtering:

```bash
# Show only SIP messages
docker compose exec frontend node src/lib/sip-engine.mjs "$PARAMS" | jq 'select(.type == "sip")'

# Show final status
docker compose exec frontend node src/lib/sip-engine.mjs "$PARAMS" | jq 'select(.event == "complete")'
```

## Features

- **Request Builder** — Method selector (INVITE/REGISTER/OPTIONS), URI input, transport picker (UDP/TCP/Auto)
- **Platform Presets** — 1-click configuration for LiveKit Cloud, Daily.co, Twilio, Asterisk, Generic SIP
- **Custom Headers** — Key-value editor with autocomplete for common SIP headers
- **SDP / Codec Picker** — Checkbox selection (Opus, PCMU, PCMA, G.722) with raw SDP override
- **SIP Timeline** — Visual transaction timeline with expandable headers, direction arrows, elapsed timestamps, color-coded status codes
- **SDP Diff View** — Side-by-side offer/answer comparison with codec badges, IP highlighting, issue detection
- **Diagnostic Insights** — Auto-detects common SIP problems (hostname in Via, private IPs, agent timeout, missing ACK)
- **Audio Injection** — Silence, tone generator, text-to-speech (espeak-ng), or file upload streamed via FFmpeg/RTP
- **Collections & History** — Save/load request configs, auto-save last 50 runs, JSON export/import
- **SIP Authentication** — Username/password for REGISTER (Digest auth)

## Development

```bash
npm run dev      # Dev server (node server.js) with Socket.io on port 3000
npm run build    # Next.js production build
npm run lint     # ESLint (includes SIP correctness rules)
npm test         # Vitest
```

## Architecture

```
frontend/
├── src/
│   ├── app/
│   │   └── page.tsx              # Main workspace — composes all components
│   ├── components/
│   │   ├── SipTimeline.tsx       # Visual SIP message timeline
│   │   ├── SdpDiff.tsx           # Offer/answer SDP comparison
│   │   ├── DiagnosticInsights.tsx # Auto-detected protocol issues
│   │   ├── HeaderEditor.tsx      # Key-value SIP header editor
│   │   ├── CodecPicker.tsx       # Codec selection + raw SDP editor
│   │   ├── AudioControls.tsx     # Audio source configuration
│   │   ├── PresetSelector.tsx    # Platform preset dropdown
│   │   └── Sidebar.tsx           # Collections & history browser
│   └── lib/
│       ├── sip-engine.mjs        # Unified parameterized SIP test runner
│       ├── presets.ts             # Platform preset definitions
│       └── collections.ts        # Save/load collections (localStorage)
├── server.js                      # HTTP server + Next.js + Socket.io init
├── server.mjs                     # Socket.io event handlers, spawns sip-engine
├── test-*.mjs                     # Standalone SIP test scripts (reference)
└── eslint-plugin-sip.mjs          # Custom ESLint rules (9 rules)
```

### Data Flow

1. User configures request in the UI (method, URI, headers, codecs, audio)
2. Click "Run" sends params via Socket.io `start-test` event
3. `server.mjs` encodes params as base64 JSON, spawns `sip-engine.mjs` as child process
4. Engine streams structured JSON events to stdout (SIP messages, diagnostics, media stats)
5. `server.mjs` parses JSON lines and relays them to the browser via Socket.io `log` events
6. UI components render events as timeline, SDP diff, and diagnostic insights

## SIP Lint Rules

Custom ESLint plugin (`eslint-plugin-sip.mjs`) with 9 rules — all extracted from real bugs that silently broke SIP call flows.

### Protocol Correctness

| Rule | Severity | Description |
|------|----------|-------------|
| `sip/no-sip-dialog` | error | `sip.dialog()` does not exist in sip v0.0.6. Manually construct ACK/BYE. |
| `sip/no-unroutable-sdp-ip` | error | Flags `0.0.0.0` and `1.1.1.1` in strings. Use real IPs from `os.networkInterfaces()`. |
| `sip/no-literal-crlf-escape` | error | Flags literal `\r\n` (4 chars) that should be actual CRLF (2 chars). |
| `sip/require-allow-in-invite` | warn | INVITE without `Allow` header (RFC 3261 Section 20.5 SHOULD). |

### Docker / NAT Awareness

| Rule | Severity | Description |
|------|----------|-------------|
| `sip/require-public-address` | error | `sip.start()` without `publicAddress` → Docker container ID in Via header. |
| `sip/no-local-ip-in-sip-uri` | error | `localIp` in `sip:` URI templates → private Docker IPs in Contact/From. |

### Code Quality (SIP-specific)

| Rule | Severity | Description |
|------|----------|-------------|
| `sip/no-spread-in-sip-headers` | error | Spread elements after critical SIP headers can silently overwrite `to`, `from`, `call-id`, `cseq`. |
| `sip/no-sdp-lf-join` | error | SDP arrays joined with `\n` instead of `\r\n` — violates RFC 4566. |
| `sip/no-random-sip-port` | error | `Math.random()` for SIP port → Contact header advertises unreachable port. |

### Running the linter

```bash
# Inside Docker (preferred)
docker compose exec frontend npm run lint

# Or locally
npm run lint
```

Rules apply to `test-*.mjs`, `src/**/*.test.ts`, and `src/lib/sip-engine.mjs`.

## Testing

```bash
# Unit tests (Vitest)
docker compose exec frontend npm test

# Full agent media test
docker compose exec frontend node test-agent.mjs

# Individual SIP test scripts
docker compose exec frontend node test-sip.mjs        # OPTIONS ping
docker compose exec frontend node test-rtp.mjs         # RTP media
docker compose exec frontend node scan-extensions.mjs  # Extension discovery

# CLI engine test (no UI, no SDK)
PARAMS=$(echo '{"method":"OPTIONS","uri":"sip:+1234567890@ID.sip.livekit.cloud","transport":"auto","headers":{},"codecs":["opus","PCMU"]}' | base64 -w 0)
docker compose exec frontend node src/lib/sip-engine.mjs "$PARAMS"
```

**Note:** Port 5060 can only be bound by one process at a time. If the dev server (`npm run dev`) is running, stop it before running sip-engine directly, or kill the conflicting process (`kill $(lsof -ti:5060)` inside the container).

## Platform Presets

| Preset | URI Pattern | Status | Notes |
|--------|------------|--------|-------|
| LiveKit Cloud | `sip:+NUMBER@ID.sip.livekit.cloud` | Verified | Full INVITE→ACK→RTP→BYE flow, PCMU negotiated |
| Daily.co | `sip:ROOM@sip.daily.co` | Untested | Daily SIP interconnect |
| Twilio Elastic SIP | `sip:NUMBER@ACCOUNT.pstn.twilio.com` | Untested | REGISTER required |
| Asterisk/FreePBX | `sip:EXT@HOST:5060` | Untested | Self-hosted PBX |
| Generic SIP | `sip:USER@HOST` | — | Blank template |

### Verified LiveKit Cloud Flow

```
→ INVITE sip:+1234567890@ID.sip.livekit.cloud     [+0ms]
← 100 Trying                                       [+523ms]
← 180 Ringing                                      [+525ms]
← 200 OK (SDP: PCMU/8000)                          [+11.6s]
→ ACK                                               [+11.6s]
  Audio: 440Hz tone → remote media endpoint
→ BYE                                               [+17.2s]
  Call completed.
```

**Common errors:**
- `404 No trunk found` — phone number doesn't match trunk's allowed numbers
- `503 Service Unavailable` (after 60s) — agent not running or not matching dispatch rule
