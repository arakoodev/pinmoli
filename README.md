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

Pinmoli exposes 7 tools to the AI agent. You describe what you want and the agent picks the right tool. See [SKILLS.md](./SKILLS.md) for full parameter reference.

| Tool | Purpose |
|------|---------|
| `sip_test` | Run OPTIONS, INVITE, or REGISTER against a SIP endpoint. Supports DTMF. |
| `webrtc_test` | Connect to a WHIP endpoint, negotiate ICE/DTLS/SRTP, send/receive audio. Supports DTMF. |
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
