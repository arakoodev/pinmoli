# Pinmoli Test Suite

## Test Coverage

### Unit Tests (26 tests)
- **Validation** (`test/unit/validation.test.ts`) - 8 tests
  - SIP URI validation
  - Config schema validation
  - Event schema validation
  - Codec validation

- **SDP Builder** (`test/unit/sdp.test.ts`) - 6 tests
  - SDP generation with various codecs
  - Line ending normalization
  - Multi-codec support

- **SIP Protocol** (`test/unit/protocol.test.ts`) - 3 tests
  - Header merging
  - Call-ID generation
  - Tag generation

- **Storage** (`test/unit/storage.test.ts`) - 5 tests
  - Save/load collections
  - Unique constraints
  - Full-text search

- **Event Buffer** (`test/unit/buffer.test.ts`) - 4 tests
  - Circular buffer (max 1000 events)
  - Event addition and retrieval
  - Clear functionality

### Integration Tests (20 tests)

- **LiveKit Cloud** (`test/integration/livekit.test.ts`) - 6 tests
  - ✅ OPTIONS connectivity test
  - ✅ INVITE call initiation
  - ✅ Timeout handling
  - ✅ SIP URI parsing
  - ✅ Multi-codec SDP generation
  - ✅ Custom media port configuration

- **SIP Handler** (`test/integration/sip-handler.test.ts`) - 3 tests
  - Config validation at skill boundary
  - Event streaming via async generator
  - All SIP methods (OPTIONS, INVITE, REGISTER)

- **TUI Manager** (`test/unit/tui.test.ts`) - 7 tests
  - View switching (timeline/SDP)
  - Event buffering
  - SDP tracking
  - Clear functionality

- **End-to-End** (`test/integration/e2e.test.ts`) - 4 tests
  - ✅ Full OPTIONS flow with TUI
  - ✅ Full INVITE flow with SDP negotiation
  - ✅ Sequential test execution
  - ✅ Complete SIP message validation

## LiveKit Cloud Testing

All tests use the real LiveKit endpoint:
```
Endpoint: sip:5eezfwavhxe.sip.livekit.cloud
Port: 5060 (UDP)
```

### Test Results
```
✓ OPTIONS: 200 OK
✓ INVITE: 100 Processing
✓ SDP Negotiation: Working
✓ Multi-codec: opus, PCMU, PCMA, G722
```

## Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage

# Specific test file
npm test test/integration/livekit.test.ts

# Integration tests only
npm test test/integration/
```

## Test Configuration

- **Timeout**: 30 seconds (for network operations)
- **Environment**: Node.js
- **Framework**: Vitest
- **Coverage**: v8

## CI/CD Ready

All tests are:
- ✅ Deterministic
- ✅ Isolated (no shared state)
- ✅ Fast (< 12 seconds total)
- ✅ Real network testing (LiveKit Cloud)
- ✅ No mocks for integration tests

## Test Output Example

```
Test Files  9 passed (9)
      Tests  49 passed (49)
   Duration  11.30s
```
