---
name: pinmoli-dev
description: Development guide for Pinmoli codebase. Use when modifying Pinmoli code, adding features, fixing bugs, or understanding the architecture. Project-specific skill for contributors.
user-invocable: false
---

# Pinmoli Development Guide

This skill provides context for AI assistants working on the Pinmoli codebase.

## Project Context

**What is Pinmoli?**
A specialized, domain-restricted AI agent for SIP/WebRTC testing. Think "Postman with Agent Mode" but exclusively for voice protocols.

**Key Constraints:**
- Exactly 5 hardcoded skills (no dynamic registration)
- Domain-restricted to SIP/WebRTC testing only
- No file editing outside ~/.pinmoli/
- No bash commands except Pinmoli itself
- Built with pi-mono libraries

## Architecture

```
TUI (src/index.ts)
  ↓
Agent Runtime (src/agent/runtime.ts)
  - Claude 3.5 Sonnet
  - System prompt (domain restricted)
  ↓
5 Skills (src/skills/index.ts)
  - sip_test, analyze_failure, save_test, load_test, list_tests
  ↓
SIP Layer (src/sip/)
  - transport.ts: UDP dgram
  - sdp.ts: SDP builder
  - protocol.ts: SIP utilities
  ↓
Storage (src/storage/db.ts)
  - SQLite + FTS5
  - Collections + History
```

## Code Patterns

### 1. Async Generators for Streaming

```typescript
export async function* executeSipTest(config: TestConfig): AsyncGenerator<SipEvent> {
  yield { type: 'network', timestamp: Date.now(), message: 'Resolving...' };
  // ... more events
  yield { type: 'sip', timestamp: Date.now(), status: 200, message: '200 OK' };
}
```

**Why:** Clean streaming, no callback hell, easy to test

### 2. Zod as Single Source of Truth

```typescript
export const SipEventSchema = z.object({
  type: z.enum(['sip', 'rtp', 'network', 'diagnostic', 'info', 'error']),
  timestamp: z.number(),
  message: z.string(),
  // ...
});

export type SipEvent = z.infer<typeof SipEventSchema>;
```

**Why:** Validation + types from one definition

### 3. Validation at Every Boundary

```typescript
export async function* sipTestHandler(config: TestConfig): AsyncGenerator<SipEvent> {
  // Validate at skill boundary
  const { TestConfigSchema } = await import('../validation/schemas.js');
  TestConfigSchema.parse(config);
  
  yield* executeSipTest(config);
}
```

**Why:** Catch errors early, fail fast

### 4. Errors as Data

```typescript
// Don't throw
yield {
  type: 'error',
  timestamp: Date.now(),
  message: 'Connection timeout',
  severity: 'fatal',
  code: 'TIMEOUT',
  recovery: 'Check network connectivity'
};
```

**Why:** No exceptions, all errors are events

### 5. Socket Cleanup Guards

```typescript
let socketClosed = false;
const closeSocket = () => {
  if (!socketClosed) {
    socketClosed = true;
    try {
      socket.close();
    } catch (e) {
      // Socket already closed
    }
  }
};
```

**Why:** Prevents "ERR_SOCKET_DGRAM_NOT_RUNNING"

## Critical Rules

### ✅ DO

1. **Test through TUI** - Never bypass the primary interface
2. **Update tests atomically** - Code changes + test updates together
3. **Start minimal** - Add complexity only when needed
4. **Use Zod for validation** - At every boundary
5. **Stream with async generators** - For real-time events
6. **Guard resource cleanup** - Flags for sockets
7. **Use regex for SIP URIs** - Not URL()
8. **Keep 5 skills only** - No dynamic registration

### ❌ DON'T

1. **Don't create throwaway test scripts** - Use proper tests
2. **Don't change signatures without updating tests**
3. **Don't over-engineer** - YAGNI principle
4. **Don't assume API names** - Read docs first
5. **Don't use URL() for SIP** - Use regex
6. **Don't add more skills** - Limit is 5
7. **Don't bypass domain restrictions** - SIP/WebRTC only

## File Structure

```
src/
├── index.ts              # TUI entry point
├── system-prompt.ts      # Domain-restricted prompt
├── agent/
│   └── runtime.ts        # Agent initialization
├── skills/
│   ├── index.ts          # Tool registration (TypeBox)
│   ├── sip-test.ts       # Async generator
│   ├── analyzer.ts       # Failure analysis
│   └── storage.ts        # SQLite wrappers
├── sip/
│   ├── transport.ts      # UDP dgram
│   ├── sdp.ts            # SDP builder
│   └── protocol.ts       # SIP utilities
├── network/
│   └── utils.ts          # IP resolution
├── storage/
│   └── db.ts             # SQLite + FTS5
├── ui/
│   ├── manager.ts        # TUI manager
│   ├── buffer.ts         # Circular buffer (max 1000)
│   └── views.ts          # Timeline/SDP views
├── config/
│   └── loader.ts         # Config management
└── validation/
    └── schemas.ts        # Zod schemas
```

## Testing

```bash
# All tests (49 tests)
npm test

# Watch mode
npm test -- --watch

# Integration tests only
npm test test/integration/

# Specific test
npm test test/integration/livekit.test.ts
```

**Test Philosophy:**
- 32 unit tests (fast, isolated)
- 17 integration tests (real LiveKit endpoints)
- No mocks for network testing
- All tests must pass before commit

## Common Tasks

### Adding a New Codec

1. Update `CodecSchema` in `src/validation/schemas.ts`
2. Add codec to `buildSdp()` in `src/sip/sdp.ts`
3. Add test in `test/unit/sdp.test.ts`
4. Update documentation

### Fixing a Bug

1. Write a failing test first
2. Fix the bug
3. Verify test passes
4. Update documentation if needed

### Adding a Feature

1. Check if it fits domain restrictions (SIP/WebRTC only)
2. Write tests first (TDD)
3. Implement feature
4. Update README and SKILLS.md
5. Add to AGENTS.md learnings if relevant

## Dependencies

**Core:**
- `@mariozechner/pi-agent-core`: Agent runtime
- `@mariozechner/pi-ai`: LLM integration
- `@sinclair/typebox`: Tool schemas (required by pi-agent-core)
- `zod`: Validation (preferred for everything else)
- `better-sqlite3`: Storage
- `sip`: SIP protocol
- `dgram`: UDP sockets (built-in)

**Dev:**
- `vitest`: Testing
- `typescript`: Type checking
- `eslint`: Linting

## Known Issues

### Agent Not Calling LLM

**Symptom:** Agent echoes messages without executing tools

**Root Cause:** LLM API not working (key, credits, network)

**Fix:** Test LLM API directly first, then debug agent

### Socket Cleanup Errors

**Symptom:** "ERR_SOCKET_DGRAM_NOT_RUNNING"

**Root Cause:** Double-closing sockets

**Fix:** Use cleanup guards (already implemented)

### Test Timeouts

**Symptom:** Integration tests timeout

**Root Cause:** Network issues or LiveKit down

**Fix:** Check network, increase timeout in vitest.config.ts

## Performance

- **sip_test**: ~100-500ms (network dependent)
- **analyze_failure**: <10ms (rule-based)
- **save_test**: <5ms (SQLite)
- **load_test**: <5ms (SQLite)
- **list_tests**: <10ms (SQLite + FTS5)

## Deployment

```bash
# Build
npm run build

# Lint
npm run lint

# Test
npm test

# Run
node dist/index.js
```

**Requirements:**
- Node.js 18+
- ANTHROPIC_API_KEY environment variable
- UDP port access (5060+)

## Documentation

- **README.md**: User documentation
- **SKILLS.md**: Skills reference
- **TESTING.md**: Test documentation
- **AGENTS.md**: Development learnings (read this!)

## LiveKit Integration

**Endpoint:** `sip:5eezfwavhxe.sip.livekit.cloud`
**Status:** ✅ Working
- OPTIONS: 200 OK
- INVITE: 100 Processing

**Credentials in .env:**
```
LIVEKIT_ENDPOINT=sip:5eezfwavhxe.sip.livekit.cloud
LIVEKIT_URL=wss://yamada-test-nklx8rpp.livekit.cloud
LIVEKIT_API_KEY=APIEFXRYComY36X
LIVEKIT_API_SECRET=CkSA7xaX93nannVsySOnEhkMXsSngkKwvRCe84eJH4n
```

## Key Learnings (from AGENTS.md)

1. **Test through TUI first** - Biggest mistake was creating throwaway scripts
2. **Test fundamentals first** - LLM API before agent integration
3. **Update tests atomically** - With code changes
4. **Start minimal** - Don't over-engineer
5. **Read docs first** - Don't assume API names
6. **Guard cleanup** - Flags for resource cleanup
7. **Use correct parsers** - Regex for SIP, not URL()

## When to Use This Skill

This skill is automatically loaded when you're working in the Pinmoli codebase. It provides context for:
- Understanding architecture
- Following code patterns
- Avoiding known mistakes
- Writing tests
- Debugging issues

**Note:** This is a background skill (`user-invocable: false`). You won't see it in the `/` menu, but Claude will use it automatically when working on Pinmoli code.
