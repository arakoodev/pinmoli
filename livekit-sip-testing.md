---
name: livekit-sip-testing
description: Specialized workflows and commands for testing LiveKit SIP Trunks and Voice Agents using a containerized Node.js, SIPp, and FFmpeg testing framework. Use this skill when troubleshooting LiveKit inbound call routing, diagnosing 503 Service Unavailable errors, or testing WebRTC SDP media negotiation against AI agents.
author: Nishir Labs
version: 1.1.0
---

# LiveKit SIP Trunk Testing Framework

This skill provides expert guidance on interacting with the "Postman for Voice" Dockerized testing framework. This framework is specifically designed to circumvent complex NAT issues and diagnose deep protocol failures when building LLM Voice Agents on top of LiveKit's SIP infrastructure.

## Core Concepts & Troubleshooting Logic

When debugging LiveKit SIP Trunks, always remember the following lifecycle and common failure points:

1.  **Transport Requirements:** LiveKit SIP trunks accept both **UDP** and **TCP** for SIP signaling (`INVITE`, `OPTIONS`). The `sip` npm package sends via UDP by default (resolving transport from the Request-URI). Do not advertise `transport=tcp` in Contact headers unless the signaling is actually sent over TCP.
2.  **The "180 Ringing" to "503 Service Unavailable" Drop:** This is a common failure state with multiple possible causes.
    *   **What it means:** If the framework receives a `180 Ringing`, it means the LiveKit Trunk successfully received the `INVITE` and matched an internal Dispatch Rule. A LiveKit Room was successfully created.
    *   **Why it fails — possible causes:**
        1.  **Agent not running:** LiveKit drops the connection after 60 seconds if the developer's AI Agent worker fails to join the room and publish an audio track.
        2.  **Test framework bug:** If the framework fails to send ACK after receiving 200 OK (e.g. calling non-existent `sip.dialog()`), the SIP dialog never completes and the call is torn down.
        3.  **SDP issues:** Invalid IPs (`0.0.0.0`) in SDP `o=`/`c=` lines or malformed SDP line endings can cause silent media negotiation failure.
    *   **The Fix:** First verify the test framework sends ACK correctly and uses valid IPs. Then check agent deployment logs (e.g., `livekit-agents` worker).
3.  **SDP Formatting:** LiveKit requires a valid, routable IP address in the SDP `o=` and `c=` lines. Using `0.0.0.0` or private Docker IPs (`172.x.x.x`) will cause silent media negotiation failure. The test scripts detect the local network IP via `os.networkInterfaces()` for use in SDP. For production use behind NAT, fetch the public IP via `ifconfig.me`. SDP lines must be joined with actual CRLF (`\r\n`), not literal backslash-r-backslash-n.
4.  **Audio Codecs:** Always ensure `opus` (Payload type 111) is offered in the SDP alongside standard `PCMU` (G.711).

## Required Workflow Execution

You **must** execute all commands exclusively through the Docker container to ensure all necessary tools (`ffmpeg`, `espeak-ng`, `sipp`, `drachtio-srf`) are available and networking is consistent.

**Never run these commands on the host machine.**

### 1. Connecting and Validating the Endpoint (Options Ping)

To verify the LiveKit endpoint is reachable and the network is open, run the Vitest test suite. This sends a strict SIP `OPTIONS` request.

```bash
docker compose exec frontend npm test
```
*Expected Result:* A passing test indicating a `200 OK` from the LiveKit proxy.

### 2. Executing the Agent Media Test (The Definitive Test)

To simulate a full inbound phone call to the agent, use the dedicated Node.js testing script. This script automatically:
1. Fetches the public IP.
2. Generates a synthetic voice prompt using `espeak-ng` ("Hello, this is a test...").
3. Sends the `INVITE`.
4. Streams the `.wav` payload over RTP via `ffmpeg` if the agent answers (`200 OK`).

```bash
docker compose exec frontend node test-agent.mjs
```

**Interpreting the Output:**
*   `-> 180 Ringing (LiveKit dispatch rule matched...)`: The call reached LiveKit.
*   `[ERROR] Received 503 Service Unavailable...`: The agent may be offline/crashed, or the test framework may have a SIP protocol error (e.g. ACK not sent). Check both the agent worker and the test framework logs.
*   `-> 200 OK (Agent joined the room and answered!)`: Success. The framework is now streaming audio to the agent and capturing the response to `response.wav`.

### 3. Modifying the Testing Parameters

The core testing logic is located in `/app/frontend/test-agent.mjs` (inside the container) or `./frontend/test-agent.mjs` (on the host).

If the user needs to test a specific phone number or dispatch rule, modify the `uri` and `To` headers within the `req` object in `test-agent.mjs`:

```javascript
// Example: Testing a specific Twilio number mapped to the trunk
uri: `sip:+14155552671@${host}`,
headers: {
  to: { uri: `sip:+14155552671@${host}` },
  // ...
}
```

### 4. Raw SIP Debugging with SIPp

For low-level protocol tracing or load testing, bypass the Node.js scripts and use the industry-standard `sipp` tool installed inside the container.

```bash
# Run a UAC (User Agent Client) scenario over TCP against the trunk
docker compose exec frontend sipp 5eezfwavhxe.sip.livekit.cloud -sn uac -m 1 -t t1 -s +1234567890 -p 5060 -trace_msg
```
*(Note: Replace the domain and `-s` extension parameter with the user's specific LiveKit configuration).*

### 5. Linting for SIP Correctness

Before committing changes to any SIP test script, run the linter. The project includes a custom ESLint plugin (`eslint-plugin-sip.mjs`) with six rules that catch the exact bugs that previously caused false 503 diagnoses and zero-session failures:

```bash
docker compose exec frontend npm run lint
```

| Rule | Severity | What it catches |
|------|----------|-----------------|
| `sip/no-sip-dialog` | error | `sip.dialog()` calls — this function does not exist in `sip` v0.0.6, causing ACK to never be sent |
| `sip/no-unroutable-sdp-ip` | error | `0.0.0.0` or `1.1.1.1` in strings — makes SDP/RTP media unroutable |
| `sip/no-literal-crlf-escape` | error | Literal `\\r\\n` (4 chars) instead of actual CRLF — produces malformed SDP |
| `sip/require-public-address` | error | `sip.start()` without `publicAddress` — causes Via header to contain Docker container ID instead of public IP |
| `sip/no-local-ip-in-sip-uri` | error | `localIp` in `sip:` URI templates — Docker private IPs (172.x.x.x) in Contact/From headers are unreachable from LiveKit |
| `sip/require-allow-in-invite` | warn | INVITE missing `Allow` header — RFC 3261 Section 20.5 SHOULD |

These rules apply to files matching `test-*.mjs` and `src/**/*.test.ts`.

**When writing new SIP test scripts**, always:
1. Manually construct ACK and BYE using headers from the INVITE transaction (never use `sip.dialog()`)
2. Fetch public IP via `getPublicIp()` and pass it to `sip.start({ publicAddress: publicIp })` — never let the library default to `os.hostname()`
3. Use `publicIp` (not `localIp`) in Contact and From SIP URI headers
4. Use `'\r\n'` (single-escaped) for SDP line endings, never `'\\r\\n'` (double-escaped)
5. Include `allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS'` in INVITE headers

## Environment Assumptions

*   The workspace directory contains a `docker-compose.yml` file with a `frontend` service based on `node:20-alpine`.
*   The target LiveKit SIP URI is defined in the `.env` file as `LIVEKIT_ENDPOINT=sip:<id>.sip.livekit.cloud`.
