# Pinmoli Tools Reference

Pinmoli provides 7 tools to the AI agent for SIP/WebRTC testing. You interact with these through natural language -- the agent selects and invokes the appropriate tool based on your request.

## `sip_test`

Execute a SIP protocol test against an endpoint.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `uri` | string | yes | -- | SIP URI (e.g., `sip:+15551234567@trunk.example.com`) |
| `method` | enum | yes | -- | `OPTIONS`, `INVITE`, or `REGISTER` |
| `codecs` | string[] | yes | -- | Codecs to offer: `opus`, `PCMU`, `PCMA`, `G722` |
| `transport` | enum | no | `auto` | `udp`, `tcp`, `tls`, or `auto` |
| `timeout` | number | no | `5000` | Request timeout in milliseconds |
| `audioSample` | string | no | `voice-hello` | Audio to send: `voice-hello`, `sine-440hz`, `sine-1000hz`, `dtmf-123`, `silence`, or a custom filename |
| `responseWaitTime` | number | no | `10` | Seconds to wait for agent audio response (0-60) |
| `sendDelay` | number | no | `0` | Seconds to listen before sending audio (0-60). Use for agents that speak first. |
| `mediaPort` | number | no | `10000` | Local RTP port |
| `auth` | object | no | -- | `{ username, password }` for REGISTER authentication |
| `headers` | object | no | -- | Custom SIP headers (key-value pairs) |
| `customSdp` | string | no | -- | Raw SDP to use instead of auto-generated offer |
| `dtmfDigits` | string | no | -- | DTMF digits to send during INVITE calls: `0-9`, `*`, `#`, `A-D` |

### SIP Methods

**OPTIONS** -- Lightweight ping. Checks if the endpoint is alive and what capabilities it advertises. No media, no call state.

**INVITE** -- Full call setup. Sends SDP offer, negotiates codecs, streams RTP audio, waits for agent response, then hangs up with BYE. This is the primary test for voice agents.

**REGISTER** -- Registration flow. Tests endpoint authentication. Supports digest auth with username/password.

### Examples

```
"Send OPTIONS to sip:trunk.example.com"
"INVITE sip:+15551234567@sip.livekit.cloud with opus and PCMU, wait 20 seconds"
"Test registration at sip:pbx.example.com with username admin password secret"
"Call the agent with a 1000Hz tone and wait 30 seconds for response"
"Listen for 8 seconds first, then send my greeting"
"Call the agent and press 1234# after the greeting"
"Test with PCMA codec -- verify A-law support"
"Call the agent using G722 for wideband audio"
"Make an INVITE offering only PCMA and PCMU, no opus"
"Call sip:pbx.example.com with G722 and send DTMF 1-2-3 after the greeting"
```

### Output

Returns a stream of SIP events:
- Request/response messages with status codes and headers
- SDP offer and answer details
- RTP send/receive statistics (packet count, duration)
- DTMF digits sent and detected (RFC 4733 telephone-event)
- Codec negotiation results
- Timing information for each step

---

## `webrtc_test`

Execute a WebRTC voice agent test via WHIP signaling.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `whipUrl` | string | yes | -- | WHIP endpoint URL (must be HTTPS, or HTTP for local dev) |
| `bearerToken` | string | no | -- | Bearer token for authenticated endpoints (LiveKit, Cloudflare) |
| `codecs` | string[] | no | `["opus"]` | Codecs to offer: `opus`, `PCMU`, `PCMA`, `G722` |
| `audioSample` | string | no | `voice-hello` | Audio to send (same samples as `sip_test`) |
| `sendDelay` | number | no | `0` | Seconds to listen before sending audio (0-60) |
| `responseWaitTime` | number | no | `10` | Seconds to wait for agent audio response (0-60) |
| `timeout` | number | no | `30000` | Connection timeout in milliseconds |
| `iceServers` | string[] | no | `["stun:stun.l.google.com:19302"]` | ICE servers (STUN/TURN URLs) |
| `dtmfDigits` | string | no | -- | DTMF digits to send: `0-9`, `*`, `#`, `A-D` |

### How it works

1. Creates a local PeerConnection (werift — pure TypeScript, no native bindings)
2. Generates an SDP offer with audio transceiver
3. POSTs the offer to the WHIP endpoint (RFC 9725)
4. Sets the SDP answer from the HTTP response
5. ICE/DTLS/SRTP negotiation proceeds automatically
6. Sends audio RTP frames from the selected sample
7. Receives agent audio and saves as WAV
8. Sends DTMF if `dtmfDigits` specified (RFC 4733 telephone-event)
9. Tears down via WHIP DELETE

### Examples

```
"Test the WHIP endpoint at https://example.com/whip with my bearer token"
"Connect to the LiveKit agent via WebRTC and wait 20 seconds"
"Send a greeting to the WHIP endpoint and press 1 after the agent responds"
```

### Output

Returns a stream of test events:
- WHIP signaling (offer/answer exchange)
- ICE connectivity checks and DTLS handshake
- RTP send/receive statistics
- DTMF digits sent and detected
- Agent audio saved as WAV file

---

## `generate_audio`

Generate custom audio samples at runtime using ffmpeg and espeak.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | enum | yes | -- | `sine`, `dtmf`, `silence`, or `speech` |
| `filename` | string | yes | -- | Output filename (without extension) |
| `frequency` | number | no | `440` | Frequency in Hz for sine waves (20-20000) |
| `duration` | number | no | `3` | Duration in seconds (0.1-30) |
| `text` | string | no | -- | Text to synthesize (required for `speech` type) |
| `digits` | string | no | -- | DTMF digits to generate: `0-9`, `*`, `#` |
| `codec` | enum | no | `PCMU` | Output codec: `PCMU` (mu-law 8kHz), `PCMA` (A-law 8kHz), or `G722` (wideband 16kHz) |

### Audio Types

| Type | Description |
|------|-------------|
| `sine` | Pure sine wave at the specified frequency |
| `dtmf` | Dual-tone multi-frequency digits |
| `silence` | Silent audio (useful as a baseline) |
| `speech` | Text-to-speech via espeak, encoded as PCMU |

Default output is PCMU @ 8kHz mono (G.711 u-law). Use the `codec` parameter for PCMA or G722 output.

### Examples

```
"Generate speech saying 'Please transfer me to billing'"
"Create a 2000Hz tone for 10 seconds"
"Generate DTMF digits 1-2-3-4"
"Make 5 seconds of silence"
"Generate a greeting in PCMA format for A-law testing"
"Create a G722 wideband tone for high-quality codec tests"
```

---

## `analyze_failure`

Analyze a failed SIP test and provide diagnostic insights.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `events` | array | yes | SIP event objects from the failed test |

### Detected Patterns

| Pattern | Diagnosis |
|---------|-----------|
| 401 Unauthorized | Authentication required -- provide credentials |
| 404 Not Found | Endpoint doesn't exist or phone number not configured on trunk |
| 488 Not Acceptable | Codec mismatch -- try different codecs |
| Timeout | Network unreachable, firewall blocking, or endpoint down |
| DNS error | Cannot resolve hostname -- check URI spelling |
| 503 after 60s | Usually synthetic -- agent worker not running or connection dropped |

### Examples

```
"Why did that test fail?"
"Analyze the failure -- I got a 404"
"What went wrong with the last INVITE?"
```

---

## `save_test`

Save a test configuration for later reuse.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Unique name (alphanumeric, hyphens, underscores) |
| `config` | object | yes | Full test configuration (same parameters as `sip_test`) |

### Examples

```
"Save this test as 'livekit-agent-check'"
"Save the INVITE config as 'daily-health'"
```

---

## `load_test`

Load and run a previously saved test configuration.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Name of the saved test |

### Examples

```
"Run the 'livekit-agent-check' test"
"Load and execute 'daily-health'"
```

---

## `list_tests`

List all saved test configurations.

### Parameters

None.

### Examples

```
"Show me all saved tests"
"What tests do I have?"
"List my test configurations"
```

---

## Common Workflows

### Test an endpoint

```
You: Test sip:trunk.example.com with OPTIONS
You: Now try an INVITE with opus and PCMU, wait 20 seconds
You: Why did it fail?
You: Save the working config as 'trunk-check'
```

### Bidirectional voice conversation

```
You: Generate speech saying "What is the current time?"
You: Call sip:+15551234567@sip.livekit.cloud with that audio, wait 30 seconds for response
```

### Test an agent that speaks first

```
You: INVITE sip:agent@example.com, listen for 10 seconds before sending audio, then wait 15 seconds for reply
```

### Codec negotiation

```
You: Test sip:trunk.example.com with PCMA codec
You: Call the agent using G722 -- I want to verify wideband support
You: Make an INVITE offering only PCMA and PCMU
You: Test with A-law encoding against the PBX
You: Now try with opus and PCMU, see which one the server picks
```

### WebRTC voice agent test

```
You: Test the WHIP endpoint at https://my-agent.example.com/whip with bearer token abc123
You: Wait 10 seconds for the agent, then send my greeting
You: Why did the ICE negotiation fail?
```

### DTMF IVR navigation

```
You: Call sip:+15551234567@trunk.example.com and press 1 after the greeting
You: Test the agent's IVR -- send DTMF 2-3-4-# after 5 seconds
You: Call the agent, wait for the menu prompt, then press * to go back
You: Connect via WebRTC and enter PIN 1234#
You: Send DTMF digits 9-1-1 during the call to test emergency routing
```

### Codec + DTMF combined

```
You: Call sip:pbx.example.com using PCMA and press 1-2-3-# after the greeting
You: Test G722 wideband with the agent, then send DTMF 0 for operator
```

### Regression testing

```
You: List my saved tests
You: Run 'daily-health'
You: Run 'livekit-agent-check'
```

---

## Packet Capture

Every Pinmoli session automatically captures all SIP signaling (port 5060) and RTP/SRTP media (UDP 10000-65535) to a pcap file. The capture runs in the background via `tcpdump` for the entire session and saves to `/app/captures/pinmoli-YYYYMMDD-HHMMSS.pcap`.

### Saving to host

**Docker Compose**: Captures appear at `./captures/` automatically (bind mount).

**Docker Run**: Mount a volume:

```bash
docker run --rm -it --network host \
  -v $(pwd)/captures:/app/captures \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/arakoodev/pinmoli
```

### Fail-fast behavior

The entrypoint validates before starting:
- `tcpdump` binary exists (exit 1 if missing — rebuild the image)
- `/app/captures` is writable (exit 1 if not)
- `tcpdump` actually starts (exit 1 if missing `CAP_NET_RAW`)
- Warns if `/app/captures` is not volume-mounted (files lost on container exit)

### Disable

```bash
PINMOLI_NO_CAPTURE=1
```

### Open in Wireshark

```bash
wireshark captures/pinmoli-20260305-143022.pcap
```
