# Pinmoli - SIP/WebRTC Testing Tool

AI-powered SIP/WebRTC testing agent with 6 specialized tools for protocol testing, audio generation, failure analysis, and test management.

**Purpose:** Generic SIP protocol testing tool that works with ANY standards-compliant SIP endpoint. Features bidirectional voice conversation with AI agents using custom speech generation.

## Quick Start

### Docker (Recommended)

```bash
# Build and run
docker-compose up

# Run tests
docker-compose run pinmoli npm test

# Run live tests with audio streaming
docker-compose run pinmoli npm test -- test/live/

# Run demo
docker-compose run pinmoli npx tsx demo/sip-streaming.ts
```

See [DOCKER.md](./DOCKER.md) for detailed Docker usage.

### Local Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Note: Audio streaming requires ffmpeg and espeak installed locally
```

## Features

- ✅ Complete SIP call flow (INVITE → ACK → RTP → BYE)
- ✅ **Speech synthesis** (espeak text-to-speech)
- ✅ **Custom audio generation** at runtime
- ✅ **Bidirectional conversation** with voice agents
- ✅ **Configurable response wait time** (0-60s)
- ✅ Real-time event streaming to TUI
- ✅ 101 tests (unit + integration + live + speech)
- ✅ Docker support with ffmpeg + espeak included
- ✅ Works with any SIP endpoint

## Audio Capabilities

### Pre-generated Samples
- **voice-hello** - "Hello, this is a test call from Pinmoli" (default)
- sine-440hz, sine-1000hz - Tone generators
- dtmf-123 - DTMF tones
- silence - Silence

### Runtime Generation
Generate custom speech at any time:
```
User: "Generate speech saying 'What is the weather today?'"
Agent: [Creates custom audio file]

User: "Test the agent with that speech and wait 20 seconds for response"
Agent: [Calls agent, sends speech, waits 20s, hangs up]
```

## Configuration

No configuration required. Pinmoli works with any standard SIP endpoint.

Simply provide the SIP URI when testing:
- `sip:endpoint.example.com`
- `sip:user@domain.com`
- `sip:+1234567890@sip.livekit.cloud` (with phone number)
- `sips:secure.example.com` (SIP over TLS)

## Available Tools

### 1. `sip_test` - Execute SIP Protocol Tests
Tests SIP endpoints with OPTIONS, INVITE, or REGISTER methods.

**Parameters:**
- `uri` (string, required): SIP URI (e.g., `sip:endpoint.example.com`)
- `method` (string, required): SIP method - `OPTIONS`, `INVITE`, or `REGISTER`
- `codecs` (array, required): Audio codecs - `opus`, `PCMU`, `PCMA`, `G722`
- `timeout` (number, optional): Timeout in milliseconds (default: 5000)
- `audioSample` (string, optional): Audio sample to use (default: `voice-hello`)
- `responseWaitTime` (number, optional): Seconds to wait for agent response (default: 10)

**Example:**
```javascript
{
  "uri": "sip:+1234567890@sip.livekit.cloud",
  "method": "INVITE",
  "codecs": ["opus", "PCMU"],
  "audioSample": "voice-hello",
  "responseWaitTime": 20
}
```

### 2. `generate_audio` - Generate Custom Audio Samples
Generate custom audio samples at runtime for testing.

**Parameters:**
- `type` (string, required): `sine`, `dtmf`, `silence`, or `speech`
- `filename` (string, required): Output filename (without extension)
- `frequency` (number, optional): Frequency in Hz for sine waves (20-20000)
- `duration` (number, optional): Duration in seconds (0.1-30)
- `text` (string, optional): Text to synthesize for speech
- `digits` (string, optional): DTMF digits (0-9, *, #)

**Example:**
```javascript
{
  "type": "speech",
  "filename": "greeting",
  "text": "Hello, welcome to our service"
}
```

### 3. `analyze_failure` - Analyze Test Failures
Analyzes failed SIP tests and provides diagnostic insights.

**Parameters:**
- `testId` (string, required): ID of the failed test to analyze

### 4. `save_test` - Save Test Configuration
Saves a test configuration for later reuse.

**Parameters:**
- `name` (string, required): Unique name for the test
- `config` (object, required): Test configuration

### 5. `load_test` - Load Saved Test
Loads and executes a previously saved test configuration.

**Parameters:**
- `name` (string, required): Name of the saved test

### 6. `list_tests` - List All Saved Tests
Lists all saved test configurations with their details.

**Parameters:** None

## Test Scripts

Several test scripts are provided for direct testing:

```bash
# Test a SIP endpoint with OPTIONS
node test-sip-options.js

# Test with INVITE
node test-sip-invite.js

# Test agent with natural language
node test-agent.js

# Test tool directly (no agent)
node test-tool-direct.js
```

## Architecture

```
┌─────────────────────────────────────┐
│   AI Agent (Claude/GPT)             │
│   - Natural language interface      │
│   - Tool orchestration              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   5 Specialized Tools                │
│   - sip_test                         │
│   - analyze_failure                  │
│   - save_test / load_test / list     │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   SIP Protocol Layer                 │
│   - UDP transport (dgram)            │
│   - SIP message builder              │
│   - SDP builder                      │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Storage Layer                      │
│   - SQLite with FTS5                 │
│   - Test configurations              │
│   - Test results & history           │
└──────────────────────────────────────┘
```

## Project Structure

```
packages/pinmoli/
├── src/
│   ├── index.ts              # Entry point
│   ├── agent/runtime.ts      # Agent initialization
│   ├── skills/               # 5 tool implementations
│   │   ├── sip-test.ts       # SIP testing tool
│   │   ├── analyzer.ts       # Failure analysis
│   │   ├── storage.ts        # Save/load/list tools
│   │   └── index.ts          # Tool registration
│   ├── sip/                  # SIP protocol
│   │   ├── transport.ts      # UDP transport
│   │   ├── sdp.ts            # SDP builder
│   │   └── protocol.ts       # SIP utilities
│   ├── storage/              # SQLite storage
│   │   └── db.ts
│   ├── validation/           # Zod schemas
│   │   └── schemas.ts
│   └── system-prompt.ts      # Domain restrictions
├── test/
│   ├── unit/                 # Unit tests (4 files)
│   └── integration/          # Integration tests (3 files)
├── test-*.js                 # Test scripts
└── README.md                 # This file
```

## Testing

```bash
# Run all tests (35 tests)
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Lint code
npm run lint
```

**Test Coverage:**
- Unit tests: Protocol, SDP, storage, validation
- Integration tests: Real SIP endpoints, protocol handlers, end-to-end flows

## Domain Restrictions

Pinmoli is **strictly limited** to SIP/WebRTC testing:
- ✅ SIP protocol testing (OPTIONS, INVITE, REGISTER)
- ✅ WebRTC signaling analysis
- ✅ SDP parsing and validation
- ✅ Network diagnostics for VoIP
- ❌ General networking tools
- ❌ Non-SIP protocols
- ❌ Unrelated tasks

## Troubleshooting

### Port Already in Use
If you see "EADDRINUSE" errors, another process is using the SIP port:
```bash
# Find process using port 5060
lsof -i :5060
# Kill it if needed
kill -9 <PID>
```

### Socket Cleanup
The transport layer includes automatic socket cleanup. If tests hang, check for:
- Firewall blocking UDP port 5060
- Network connectivity issues
- Invalid SIP endpoint

### Troubleshooting

For any SIP service testing:
1. Verify the SIP URI format is correct
2. Check network connectivity to the endpoint
3. Ensure UDP port 5060 is not blocked by firewall
4. Review test results and error messages
5. Use `analyze_failure` tool for detailed diagnostics

## License

MIT
