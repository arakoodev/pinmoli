# Pinmoli Tools Reference

Pinmoli provides 6 tools to the AI agent for SIP/WebRTC testing. You interact with these through natural language -- the agent selects and invokes the appropriate tool based on your request.

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
```

### Output

Returns a stream of SIP events:
- Request/response messages with status codes and headers
- SDP offer and answer details
- RTP send/receive statistics (packet count, duration)
- Codec negotiation results
- Timing information for each step

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

### Audio Types

| Type | Description |
|------|-------------|
| `sine` | Pure sine wave at the specified frequency |
| `dtmf` | Dual-tone multi-frequency digits |
| `silence` | Silent audio (useful as a baseline) |
| `speech` | Text-to-speech via espeak, encoded as PCMU |

All output is PCMU @ 8kHz mono (G.711 u-law) for SIP compatibility.

### Examples

```
"Generate speech saying 'Please transfer me to billing'"
"Create a 2000Hz tone for 10 seconds"
"Generate DTMF digits 1-2-3-4"
"Make 5 seconds of silence"
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

### Codec testing matrix

```
You: Test sip:trunk.example.com with INVITE using only opus
You: Now test with only PCMU
You: Now test with both opus and PCMU
```

### Regression testing

```
You: List my saved tests
You: Run 'daily-health'
You: Run 'livekit-agent-check'
```
