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

- **Natural language interface** -- describe tests in plain English
- **Full SIP call flows** -- OPTIONS, INVITE with SDP, REGISTER with auth, ACK, BYE
- **WebRTC via WHIP** -- connect to any WHIP endpoint (LiveKit, Cloudflare, Janus)
- **Bidirectional RTP audio** -- send speech, receive and measure agent responses
- **DTMF send and receive (RFC 4733)** -- navigate IVR menus, detect incoming DTMF
- **Runtime speech synthesis** -- espeak (offline) or Gemini TTS (high quality, Vertex AI)
- **Real codec negotiation** -- PCMU, PCMA, G722, opus with automatic transcoding
- **Failure analysis** -- pattern-matched diagnostics with actionable recovery steps
- **Test persistence** -- save, load, list test configs (SQLite + FTS5)
- **Per-session output** -- each run creates a directory with signaling logs, metadata, flow.json, audio WAVs
- **Interactive multi-turn calls** -- start_call → send_audio → receive_audio → end_call, with live TUI indicators
- **Snapshot replay** -- replay saved interactive calls from WAV files against the live endpoint, compare results
- **Session replay** -- re-execute recorded sessions without LLM, compare flows
- **Automatic packet capture** -- SIP + RTP traffic to pcap (Wireshark-ready)
- **Pipe mode** -- stdin/stdout for scripting and CI
- **STUN NAT discovery** -- public IP:port for SDP, works in WSL2/Docker
- **Runs in Docker** -- ffmpeg, espeak, tcpdump, tini included

## Quick Start

### Prerequisites

- Docker
- An LLM provider credential (see below)

### Google Vertex AI (Recommended)

Vertex AI gives you Gemini as the LLM provider plus Gemini TTS for high-quality speech generation. The docker-compose.yml is pre-configured -- just drop in a service account key.

**1. Create a service account:**

```bash
# In Google Cloud Console or via gcloud:
gcloud iam service-accounts create pinmoli \
  --display-name="Pinmoli SIP Tester"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:pinmoli@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud iam service-accounts keys create secrets/gcp-service-account.json \
  --iam-account=pinmoli@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

**2. Place the JSON key:**

```bash
mkdir -p secrets
# Move your downloaded key to:
# secrets/gcp-service-account.json
```

**3. Set your project (if not `lifeandhalf-24122025`):**

Create or edit `.env`:

```bash
GOOGLE_CLOUD_PROJECT=your-project-id
# GOOGLE_CLOUD_LOCATION=us-central1  # default, change if needed
```

**4. Start Pinmoli:**

```bash
docker compose build
docker compose up -d
docker compose exec pinmoli npx tsx src/cli.ts --service-account /app/secrets/gcp-service-account.json
```

The `docker-compose.yml` maps `secrets/` into the container at `/app/secrets/` (via the `.:/app` bind mount) and sets `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION` automatically.

### Other Providers

Set one environment variable and Pinmoli auto-detects the provider:

**Anthropic:**
```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
docker compose exec pinmoli npx tsx src/cli.ts
```

**OpenAI:**
```bash
echo "OPENAI_API_KEY=sk-..." >> .env
docker compose exec pinmoli npx tsx src/cli.ts
```

**Google Gemini (API key):**
```bash
echo "GEMINI_API_KEY=..." >> .env
docker compose exec pinmoli npx tsx src/cli.ts
```

> **Note:** The Gemini API key path does not support TTS. Use Vertex AI (service account) for Gemini TTS.

**Groq:**
```bash
echo "GROQ_API_KEY=gsk_..." >> .env
docker compose exec pinmoli npx tsx src/cli.ts
```

**OpenRouter:**
```bash
echo "OPENROUTER_API_KEY=..." >> .env
docker compose exec pinmoli npx tsx src/cli.ts
```

### Pre-built Image (GHCR)

```bash
docker pull ghcr.io/arakoodev/pinmoli:latest
```

Run with any provider:

```bash
# Anthropic
docker run --rm -it --network host \
  -v $(pwd)/captures:/app/captures \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/arakoodev/pinmoli

# OpenAI
docker run --rm -it --network host \
  -v $(pwd)/captures:/app/captures \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/arakoodev/pinmoli

# Google Gemini (API key)
docker run --rm -it --network host \
  -v $(pwd)/captures:/app/captures \
  -e GEMINI_API_KEY=... \
  ghcr.io/arakoodev/pinmoli

# Google Vertex AI (service account)
docker run --rm -it --network host \
  -v $(pwd)/captures:/app/captures \
  -v /path/to/key.json:/credentials.json:ro \
  ghcr.io/arakoodev/pinmoli --service-account /credentials.json

# Groq
docker run --rm -it --network host \
  -v $(pwd)/captures:/app/captures \
  -e GROQ_API_KEY=gsk_... \
  ghcr.io/arakoodev/pinmoli
```

The `-v $(pwd)/captures:/app/captures` mount persists packet captures and session output to your local machine. The image is published automatically on every push to `main` via [GitHub Actions](./.github/workflows/docker-publish.yml).

## Usage

### Interactive TUI

```bash
docker compose exec pinmoli npx tsx src/cli.ts
```

Type test requests in natural language. Slash commands:

- `/model anthropic claude-sonnet-4-5` -- switch LLM provider/model at runtime
- `/model` -- show current provider and model
- `/service-account /path/to/key.json` -- configure Vertex AI credentials
- Ctrl+C -- abort current operation / clear input / quit

### Pipe Mode

For scripting, CI, or piping from another process:

```bash
# Single message
echo "test sip:+1234567890@host with OPTIONS" | \
  docker compose exec -T pinmoli npx tsx src/cli-pipe.ts

# Multi-turn conversation
docker compose exec -T pinmoli npx tsx src/cli-pipe.ts <<'EOF'
test sip:+1234567890@trunk.example.com with OPTIONS
now try INVITE with PCMU, sendDelay 8, responseWaitTime 20
analyze the failure
EOF
```

Agent responses go to **stdout**, tool output and status go to **stderr**.

### Replay Mode

Re-execute a recorded session without the LLM. Compares the replay flow against the original:

```bash
docker compose exec pinmoli npx tsx src/cli-replay.ts captures/<session-id>
```

The session directory must contain a `manifest.json` (auto-created by Pinmoli). Each tool call is replayed with the same parameters. Original and replay `flow.json` files are compared side-by-side, showing sequence matches, timing deltas, and codec/RTP differences.

```bash
# Example
docker compose exec pinmoli npx tsx src/cli-replay.ts captures/20260320-065054-tw1x
```

### Run Without the AI Agent

Use the SIP engine directly as a library:

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

## Multi-Turn Interactive Calls

Beyond one-shot tests (`sip_test`), Pinmoli supports **interactive multi-turn SIP conversations** — call a voice agent, listen to its greeting, speak back, listen to its response, repeat. The call stays open across tool calls, and the AI agent drives the conversation.

### The Interactive Tools

| Tool | Purpose |
|------|---------|
| `start_call` | INVITE → 200 OK → ACK. Returns a `callId` for subsequent tools |
| `send_audio` | Send a WAV file (auto-wired from `generate_audio`) or DTMF digits |
| `receive_audio` | Listen for agent audio for N seconds (max 60), save as WAV |
| `end_call` | BYE → close sockets → cleanup |

### Example: Two-Turn Conversation

Tell the TUI what you want in plain English:

```
You: Call sip:+18144693283@5789pyhutlx.sip.livekit.cloud and have
     a two-turn conversation. Say hello twice, listen between each.
```

The agent orchestrates the call through the four tools. Each tool appears as a collapsible section in the TUI with real-time event streaming:

```
 ▼ ⠙ start_call (12 events)                    ← bright yellow, animated spinner
   [INFO] +0.045s Starting SIP INVITE to sip:+18144693283@...
   [INFO] +0.058s Public IP: 34.56.78.90, RTP mapped to :54321 (STUN)
   [SIP]  +0.321s Sending INVITE request...
   [SIP]  +0.493s Received 100 Processing
   [SIP]  +2.100s Received 180 Ringing
   [SIP]  +5.850s Received 200 OK
   [INFO] +5.851s Codec negotiated: PCMU (PT=0, clock=8000Hz)
   [SIP]  +5.852s Sending ACK
   [INFO] +5.853s Call established — callId: abc123, codec: PCMU
 ▶ ✓ start_call (12 events)                     ← auto-collapses, checkmark

 ▼ ⠧ send_audio (2 events)                      ← turn 1: send greeting
   [INFO] +0.015s Sending audio as PCMU to 34.56.78.90:10000
   [INFO] +3.200s Sent 260 RTP packets — saved: sent-audio-1.wav
 ▶ ✓ send_audio (2 events)

 ▼ ⠸ receive_audio (2 events)                   ← turn 1: agent responds
   [INFO] +0.008s Listening for audio on port 54321 (15s)...
   [INFO] +12.340s Received 735 RTP packets — saved: agent-response-2.wav
 ▶ ✓ receive_audio (2 events)

 ▼ ⠴ send_audio (2 events)                      ← turn 2: send again
   [INFO] +0.012s Sending audio as PCMU to 34.56.78.90:10000
   [INFO] +3.180s Sent 258 RTP packets — saved: sent-audio-3.wav
 ▶ ✓ send_audio (2 events)

 ▼ ⠦ receive_audio (2 events)                   ← turn 2: agent responds
   [INFO] +0.009s Listening for audio on port 54321 (15s)...
   [INFO] +14.100s Received 740 RTP packets — saved: agent-response-5.wav
 ▶ ✓ receive_audio (2 events)

 ▼ ⠙ end_call (2 events)                        ← hang up
   [SIP]  +0.100s Sending BYE
   [SIP]  +0.200s Call terminated
 ▶ ✓ end_call (2 events)
```

### How to Know if a Call is Active

The TUI's `ToolOutputSection` component shows call state visually:

| Indicator | Meaning |
|-----------|---------|
| `▼ ⠧ start_call (5 events)` | **Running** — bright yellow header, animated braille spinner cycling at 80ms (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏), section expanded, events streaming live |
| `▶ ✓ receive_audio (2 events)` | **Succeeded** — dimmed header, checkmark, section auto-collapsed |
| `▶ ✗ start_call (8 events)` | **Failed** — dimmed header, X mark, section auto-collapsed |

**The spinner is the primary active-call indicator.** During `receive_audio`, it keeps spinning for the entire listen duration (up to 60 seconds) — you can see at a glance that a call is alive and recording.

**Ctrl+O** toggles expansion of the last completed tool section to re-inspect events.

**Between tool calls**, the call is still active even though no section is spinning. The agent tracks the `callId` in its conversation context and knows the call is open until `end_call`. If you ask "is the call still active?" the agent can answer based on whether it has called `end_call` yet.

**On exit (Ctrl+C)**, `terminateAll()` sends BYE on every active call before the process exits — no orphaned calls.

### Listen-First Pattern

Some agents speak first. Listen before sending:

```
You: Call the agent, wait 8 seconds for its greeting, then respond.
```

The agent calls `receive_audio` immediately after `start_call` (before any `send_audio`), capturing the agent's opening message.

### Session Artifacts

Each interactive call writes to its own directory under `captures/`:

```
captures/20260323-140530-x7k2/
  sip-invite-5789pyhutlx.sip.livekit.cloud-20260323-140530/
    sip-log.txt               ← raw SIP messages (>>>SENT, <<<RECEIVED)
    metadata.json              ← duration, codec, success, turn count
    sent-audio-1.wav           ← what you sent (turn 1)
    agent-response-2.wav       ← what the agent said (turn 1)
    sent-audio-3.wav           ← what you sent (turn 2)
    agent-response-4.wav       ← what the agent said (turn 2)
    scenario-manifest.json     ← turn structure for snapshot replay
    flow.json                  ← structured event timeline
```

File numbering follows the turn counter: sends get odd numbers (1, 3, 5...), receives get even numbers (2, 4, 6...).

### Snapshot Replay

After running interactive scenarios, replay the exact same conversation from saved WAV files — no TTS, no LLM:

```bash
# Run scenarios to generate snapshots
docker compose exec pinmoli npx tsx test/scenarios/run-scenarios.ts

# Replay all scenarios from a session
docker compose exec pinmoli npx tsx src/cli-replay-snapshot.ts captures/20260323-140530-x7k2

# Replay one specific scenario
docker compose exec pinmoli npx tsx src/cli-replay-snapshot.ts \
  captures/20260323-140530-x7k2 --scenario 2-multi-turn
```

The replay engine reads `scenario-manifest.json`, opens a real SIP call to the same URI, sends the same audio files in order, listens for the same durations, and compares:

- **Signaling sequence** — INVITE/100/180/200/ACK/BYE must match
- **Per-turn audio match** — both original and replay got audio, or both got silence
- **Packet count tolerance** — within 30% (agent speech varies between runs)

```
--- 2-multi-turn ---
Turn 1: 710 pkts (original: 735) — MATCH
Turn 2: 698 pkts (original: 740) — MATCH
  PASS | 37.2s (original: 37.0s)
  Sequence: MATCH
  Codec: PCMU (match)
```

### Programmatic Scenarios

The scenario runner exercises multi-turn calls without an LLM:

```bash
docker compose exec pinmoli npx tsx test/scenarios/run-scenarios.ts
```

| Scenario | Turns | Description |
|----------|-------|-------------|
| `1-new-customer` | 1 | Send greeting, listen for response |
| `2-multi-turn` | 2 | Greeting + follow-up |
| `3-listen-first` | 1 | Listen 8s for agent greeting before speaking |
| `4-silence-test` | 1+extra | Send once, then listen without speaking (timeout behavior) |
| `5-rapid-exchange` | 3 | Three quick turns — RTP continuity stress test |

Each scenario writes `scenario-manifest.json` + `flow.json` for later snapshot replay.

## Examples

Every example below has a corresponding integration test in `test/integration/readme-prompts.test.ts`.

**SIP basics:**

```
Send OPTIONS to sip:trunk.example.com
INVITE sip:+15551234567@sip.livekit.cloud with opus and PCMU
Register at sip:pbx.example.com with username admin password secret
```

**Codec negotiation:**

```
Test with PCMA codec -- I want to verify A-law support
Call the agent using G722 and wait 20 seconds for a response
Test sip:pbx.example.com offering only PCMA and PCMU, see which it picks
```

**DTMF and IVR navigation:**

```
Call sip:+15551234567@trunk.example.com and press 1-2-3-# after the greeting
Call sip:+18005551234@trunk.example.com, press 1 for sales, then 0 for operator
Connect via WebRTC to https://agent.example.com/whip and enter PIN 1234#
```

**Speech generation:**

```
Generate speech saying "What is the weather today?" then call the agent
Generate a 1000Hz sine wave for 5 seconds, then test the endpoint
Make the greeting say "Por favor espere" in Spanish, then test
Generate speech with gemini saying "Hello, I need help with my account"
```

**Bidirectional conversations:**

```
Call sip:agent@example.com, listen for 5 seconds first, then send my greeting
INVITE sip:agent@livekit.cloud, send the greeting, wait 30 seconds for a response
```

**WebRTC:**

```
Test the WHIP endpoint at https://my-agent.example.com/whip with bearer token abc123
```

**Save, load, and batch:**

```
Save this test as "production-health-check"
Show me all saved tests, then run one
Compare sip:trunk-us.example.com and sip:trunk-eu.example.com
Test these servers: sip:a.example.com, sip:b.example.com, sip:c.example.com
```

**Failure analysis:**

```
Why did it fail?
What went wrong? (after a 488 codec mismatch)
```

**Advanced combos:**

```
Generate speech "Hello, I need billing support", call with PCMA, then press 2 for billing
Test sip:agent@broken-trunk.com, analyze the failure, fix it with TCP, save the config
```

## Configuration

### LLM Provider

| Provider | `--provider` | Env var | Default model |
|----------|-------------|---------|---------------|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |
| OpenAI | `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| Google Gemini | `google` | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| Google Vertex AI | `google-vertex` | `--service-account <path>` | `gemini-2.5-pro` |
| Groq | `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4.5` |

The provider is auto-detected from whichever env var you set. Use `--provider` to override:

```bash
pinmoli --provider openai --model gpt-4o
pinmoli --provider anthropic --model claude-haiku-4-5
```

### CLI Flags

```
pinmoli [options]

  --provider <name>          LLM provider (anthropic, openai, google, google-vertex, groq, openrouter)
  --model <id>               Model ID (default depends on provider)
  --tts-model <id>           Gemini TTS model (default: gemini-2.5-flash-tts, Vertex AI only)
  --service-account <path>   GCP service account JSON (implies google-vertex)
  --help                     Show usage
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic provider |
| `OPENAI_API_KEY` | OpenAI provider |
| `GEMINI_API_KEY` | Google Gemini provider |
| `GROQ_API_KEY` | Groq provider |
| `OPENROUTER_API_KEY` | OpenRouter provider |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account JSON (Vertex AI) |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (default: `lifeandhalf-24122025`) |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI region (default: `us-central1`) |
| `LIVEKIT_ENDPOINT` | LiveKit SIP endpoint for live tests |
| `PINMOLI_NO_CAPTURE` | Set to `1` to disable packet capture |

### Docker Compose

The default `docker-compose.yml` uses `network_mode: host` so SIP and RTP traffic reaches the network directly. The `.env` file at the repo root is loaded automatically. Source directory is bind-mounted, so code changes are reflected immediately.

## Session Output

Each Pinmoli session creates a directory under `captures/` grouping all artifacts:

```
captures/{session-id}/
├── manifest.json                    # Tool calls with params, timing, success/failure
├── audio-samples/                   # Generated TTS audio (espeak, Gemini)
├── sip-invite-host-20260320-181341/
│   ├── sip-log.txt                  # Every SIP message sent/received with ISO timestamps
│   ├── metadata.json                # Config, duration, responses, codec, public IP
│   ├── flow.json                    # Structured signaling flow (for replay comparison)
│   ├── agent-greeting.wav           # Agent's greeting (if sendDelay > 0)
│   ├── sent-audio.wav               # Outbound audio (transcoded to negotiated codec)
│   └── agent-response.wav           # Agent's response audio
├── sip-options-host-20260320-180000/
│   ├── sip-log.txt
│   ├── metadata.json
│   └── flow.json
└── webrtc-whip-host-20260320-182000/
    ├── signaling-log.txt            # WHIP offer/answer exchange
    ├── metadata.json
    ├── flow.json
    └── *.wav                        # Audio files (opus decoded via OGG + ffmpeg)
```

The `manifest.json` records every tool call the LLM made during the session, enabling [replay mode](#replay-mode) to re-execute without the LLM.

### Packet Capture

Background `tcpdump` captures SIP (port 5060) + RTP (UDP 10000-65535) for every session. Saves to `captures/pinmoli-YYYYMMDD-HHMMSS.pcap`.

**Docker Compose:** Captures appear at `./captures/` automatically (bind mount).

**Docker Run:** Mount a volume:

```bash
docker run --rm -it --network host \
  -v $(pwd)/captures:/app/captures \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/arakoodev/pinmoli
```

Open in Wireshark:

```bash
wireshark captures/pinmoli-20260305-143022.pcap
```

### Disable Capture

```bash
docker run --rm -it --network host \
  -e PINMOLI_NO_CAPTURE=1 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/arakoodev/pinmoli
```

## Audio Samples

### Pre-generated (included in the Docker image)

| Sample | Description | Duration |
|--------|-------------|----------|
| `voice-hello` | "Hello, this is a test call from Pinmoli" | ~3s |
| `sine-440hz` | 440 Hz sine wave | 3s |
| `sine-1000hz` | 1000 Hz sine wave | 3s |
| `dtmf-123` | DTMF tones 1-2-3 | 1.5s |
| `silence` | Silence | 3s |

All samples are PCMU @ 8kHz mono (G.711 u-law).

### Runtime TTS

By default, `generate_audio` uses espeak (offline, fast). With Vertex AI configured, use Gemini TTS for higher quality:

```
Generate speech saying "Please transfer me to billing"
Generate speech with gemini saying "Hello, I need help with my account"
```

> Gemini TTS requires Vertex AI (service account). The `GEMINI_API_KEY` path does not support TTS.

## Tools

Pinmoli exposes 11 tools to the AI agent. You describe what you want and the agent picks the right tool.

**One-shot tests:**

| Tool | Purpose |
|------|---------|
| `sip_test` | Run OPTIONS, INVITE, or REGISTER against a SIP endpoint. Supports DTMF. |
| `webrtc_test` | Connect to a WHIP endpoint, negotiate ICE/DTLS/SRTP, send/receive audio. Supports DTMF. |

**Interactive multi-turn calls:**

| Tool | Purpose |
|------|---------|
| `start_call` | INVITE → 200 OK → ACK. Returns `callId` for subsequent tools. |
| `send_audio` | Send audio (auto-wired from `generate_audio`) or DTMF on an active call. |
| `receive_audio` | Listen for agent audio on an active call (1-60s), save as WAV. |
| `end_call` | BYE → close sockets → cleanup. Always call when done. |

**Utilities:**

| Tool | Purpose |
|------|---------|
| `generate_audio` | Create audio samples (sine, DTMF, silence, TTS via espeak or Gemini). |
| `analyze_failure` | Diagnose a failed test and suggest fixes. |
| `save_test` | Save a test configuration by name (SQLite). |
| `load_test` | Load a saved test configuration by name. |
| `list_tests` | List all saved test configurations. |

## Troubleshooting

### Port 5060 already in use

Only one process can bind the SIP port. Kill the conflicting process inside the container:

```bash
docker compose exec pinmoli sh -c 'kill $(lsof -ti:5060)'
```

### No RTP packets received

1. **NAT/firewall** -- private IPs (WSL2 `172.x`, Docker `172.x`) are not routable. Run from a host with a public IP or use `network_mode: host`.
2. **No agent running** -- the remote endpoint accepted the call but has no worker to generate audio.

### 503 Service Unavailable after 60s

Usually a synthetic 503 from the `sip` npm library when TCP drops. Common causes: agent worker not running, malformed SDP, unroutable IPs, missing ACK.

### LLM not responding

Check credentials are accessible inside the container:

```bash
# Vertex AI
docker compose exec pinmoli ls -la /app/secrets/gcp-service-account.json

# API key providers — verify .env is loaded
docker compose exec pinmoli env | grep API_KEY
```

## Contributing

```bash
git clone https://github.com/your-fork/pinmoli.git
cd pinmoli
docker compose build
docker compose up -d

# Run tests (must pass before submitting a PR)
docker compose exec pinmoli npx vitest run
docker compose exec pinmoli npx tsc --noEmit
docker compose exec pinmoli npm run lint
```

All commands run inside Docker. See [ARCHITECTURE.md](./ARCHITECTURE.md) for codebase internals, engine design, and project structure.

## License

MIT
