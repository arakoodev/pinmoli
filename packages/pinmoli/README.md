# Pinmoli - SIP/WebRTC Testing Tool

AI-powered SIP/WebRTC testing agent with 5 specialized tools for protocol testing, failure analysis, and test management.

**Purpose:** Generic SIP protocol testing tool that works with ANY standards-compliant SIP endpoint. No service-specific integrations required - uses pure SIP/SDP protocol over UDP/TCP.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests (35 tests, includes any SIP service integration)
npm test

# Run the agent directly
node dist/index.js
```

## Configuration

No configuration required. Pinmoli works with any standard SIP endpoint.

Simply provide the SIP URI when testing:
- `sip:endpoint.example.com`
- `sip:user@domain.com`
- `sips:secure.example.com` (SIP over TLS)

## Available Tools

### 1. `sip_test` - Execute SIP Protocol Tests
Tests SIP endpoints with OPTIONS, INVITE, or REGISTER methods.

**Parameters:**
- `endpoint` (string, required): SIP URI (e.g., `sip:endpoint.example.com`)
- `method` (string, required): SIP method - `OPTIONS`, `INVITE`, or `REGISTER`
- `timeout` (number, optional): Timeout in milliseconds (default: 5000)

**Example:**
```javascript
{
  "endpoint": "sip:pbx.example.com",
  "method": "OPTIONS",
  "timeout": 5000
}
```

### 2. `analyze_failure` - Analyze Test Failures
Analyzes failed SIP tests and provides diagnostic insights.

**Parameters:**
- `testId` (string, required): ID of the failed test to analyze

### 3. `save_test` - Save Test Configuration
Saves a test configuration for later reuse.

**Parameters:**
- `name` (string, required): Unique name for the test
- `endpoint` (string, required): SIP URI
- `method` (string, required): SIP method
- `timeout` (number, optional): Timeout in milliseconds

### 4. `load_test` - Load Saved Test
Loads and executes a previously saved test configuration.

**Parameters:**
- `name` (string, required): Name of the saved test

### 5. `list_tests` - List All Saved Tests
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
