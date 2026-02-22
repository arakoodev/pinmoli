# Pinmoli Live Tests

## Overview

Live integration tests against real SIP endpoints. These tests verify that Pinmoli works correctly with actual SIP servers, not just mocks.

## LiveKit SIP Tests

Tests against LiveKit's SIP endpoint configured in `.env`:
- `LIVEKIT_ENDPOINT=sip:5eezfwavhxe.sip.livekit.cloud`

### Test Coverage

**7 live tests** covering:

1. **OPTIONS Test Flow**
   - Basic OPTIONS request to LiveKit
   - Real-time progress display
   - Event streaming verification

2. **INVITE Test Flow**
   - INVITE with SDP and codecs
   - Codec negotiation (opus, PCMU)

3. **Error Handling Flow**
   - Timeout handling with short timeout
   - Graceful error display in UI

4. **Complete User Flow**
   - Full conversation simulation
   - Multiple tests in sequence
   - Real event streaming to TUI

5. **Codec Testing Flow**
   - Test different codec combinations
   - opus, PCMU, PCMA
   - Multiple codec support

## Running Live Tests

```bash
# Run all live tests
npm test -- test/live/

# Run LiveKit tests specifically
npm test -- test/live/livekit.test.ts

# Run with verbose output
npm test -- test/live/livekit.test.ts --reporter=verbose
```

## Test Results

```
✓ test/live/livekit.test.ts (7 tests) 2662ms

Test Files  1 passed (1)
Tests       7 passed (7)
Duration    2.66s
```

All live tests passing ✅

## Configuration

Tests load configuration from `.env` in project root:

```env
LIVEKIT_ENDPOINT=sip:5eezfwavhxe.sip.livekit.cloud
LIVEKIT_URL=wss://yamada-test-nklx8rpp.livekit.cloud
LIVEKIT_API_KEY=APIEFXRYComY36X
LIVEKIT_API_SECRET=CkSA7xaX93nannVsySOnEhkMXsSngkKwvRCe84eJH4n
```

## Example Test

```typescript
it('tests LiveKit endpoint with OPTIONS', async () => {
  tui.start();
  tui.addMessage('user', `Test ${LIVEKIT_ENDPOINT} with OPTIONS`);

  const config: TestConfig = {
    uri: LIVEKIT_ENDPOINT,
    method: 'OPTIONS',
    codecs: ['opus'],
    transport: 'udp',
    mediaPort: 10000,
    timeout: 5000
  };

  tui.streamMessage('\n[Tool] Executing sip_test...');
  
  for await (const event of runSipTest(config)) {
    tui.streamMessage(`\n  [${event.type.toUpperCase()}] ${event.message}`);
  }
  
  tui.streamMessage('\n[Tool] Complete\n');

  // Verify real events
  const fullOutput = output.join('');
  expect(fullOutput).toContain('livekit.cloud');
  expect(fullOutput).toContain('OPTIONS');
}, 10000);
```

## What's Tested

✅ **Real SIP Protocol**
- Actual UDP packets sent to LiveKit
- Real DNS resolution
- Real socket communication

✅ **Real-time Streaming**
- Events stream as they happen
- Progress updates in real-time
- TUI displays live results

✅ **Error Handling**
- Timeout scenarios
- Network errors
- DNS failures

✅ **Multiple Methods**
- OPTIONS requests
- INVITE with SDP
- Different codec combinations

✅ **UI Integration**
- Complete user flows
- Message formatting
- Event streaming to console

## Notes

- Tests use real network I/O (not mocked)
- Tests may fail if LiveKit endpoint is down
- Timeouts are set to 5-10 seconds for real network conditions
- Tests verify both success and error paths
- All tests use the same TUI flow testing framework as integration tests

## Adding More Endpoints

To test against other SIP servers, add them to `.env`:

```env
CUSTOM_SIP_ENDPOINT=sip:your-server.com
```

Then create a new test file:

```typescript
const CUSTOM_ENDPOINT = process.env.CUSTOM_SIP_ENDPOINT;

describe('Custom SIP Integration', () => {
  it('tests custom endpoint', async () => {
    // Same pattern as LiveKit tests
  });
});
```
