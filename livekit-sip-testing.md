---
name: livekit-sip-testing
description: Specialized workflows and commands for testing LiveKit SIP Trunks and Voice Agents using a containerized Node.js, SIPp, and FFmpeg testing framework. Use this skill when troubleshooting LiveKit inbound call routing, diagnosing 503 Service Unavailable errors, or testing WebRTC SDP media negotiation against AI agents.
author: Nishir Labs
version: 1.0.0
---

# LiveKit SIP Trunk Testing Framework

This skill provides expert guidance on interacting with the "Postman for Voice" Dockerized testing framework. This framework is specifically designed to circumvent complex NAT issues and diagnose deep protocol failures when building LLM Voice Agents on top of LiveKit's SIP infrastructure.

## Core Concepts & Troubleshooting Logic

When debugging LiveKit SIP Trunks, always remember the following lifecycle and common failure points:

1.  **Transport Requirements:** LiveKit public media servers heavily favor **TCP** for the initial SIP signaling (`INVITE`, `OPTIONS`). Pure UDP signaling is often dropped if NAT topology isn't perfectly negotiated.
2.  **The "180 Ringing" to "503 Service Unavailable" Drop:** This is the most common failure state.
    *   **What it means:** If the framework receives a `180 Ringing`, it means the LiveKit Trunk successfully received the `INVITE` and matched an internal Dispatch Rule. A LiveKit Room was successfully created.
    *   **Why it fails:** LiveKit will drop the TCP connection precisely 60 seconds later, returning a `503 Service Unavailable`, if the developer's background worker (the actual AI Agent process) fails to join the room and publish an audio track.
    *   **The Fix:** This is *not* a telecom failure. Instruct the user to check their agent deployment logs (e.g., `livekit-agents` worker).
3.  **SDP Formatting:** LiveKit requires a valid, public IP address in the SDP `o=` and `c=` lines. If you offer a private Docker IP (`172.x.x.x`), the LiveKit WebRTC backend (Pion) will silently reject the media negotiation during ICE candidate gathering. The framework automatically fetches the public IP via `ifconfig.me` to prevent this.
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
*   `[ERROR] Received 503 Service Unavailable...`: The agent is offline or crashed. Instruct the user to restart their agent worker.
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

## Environment Assumptions

*   The workspace directory contains a `docker-compose.yml` file with a `frontend` service based on `node:20-alpine`.
*   The target LiveKit SIP URI is defined in the `.env` file as `LIVEKIT_ENDPOINT=sip:<id>.sip.livekit.cloud`.
