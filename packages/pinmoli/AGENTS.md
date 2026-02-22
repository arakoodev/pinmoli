# Agent Development Learnings: Pinmoli

## Project Overview
Built Pinmoli - an AI-powered SIP/WebRTC testing agent using pi-mono libraries. A domain-restricted agent (voice testing only) that helps developers test SIP endpoints through natural language, similar to "Postman with Agent Mode" but for voice protocols.

## Critical Mistakes & Learnings

### 1. **Testing Through Random Scripts Instead of TUI**
**Mistake**: Created standalone test scripts (`test-livekit.js`, `test-agent.js`, `test-tool-direct.js`) to verify functionality instead of testing through the actual TUI interface.

**Why Wrong**: 
- Violated the core principle: functionality must work through the intended interface
- Created technical debt (throwaway scripts)
- Didn't validate the actual user experience
- Wasted time on code that won't be used

**Correct Approach**:
- Always test through the primary interface first
- Write integration tests that exercise the full stack
- Use test scripts only for isolated unit testing
- If TUI doesn't work, fix the TUI - don't work around it

**Lint**: ⚠️ Never bypass the primary interface to "prove" functionality works

---

### 2. **Agent Not Calling LLM - Debugging Wrong Layer**
**Mistake**: Spent time debugging agent initialization, event subscriptions, and tool registration when the agent was just echoing messages without calling the LLM.

**Root Cause**: The agent framework was correctly set up, but I didn't verify the most basic requirement: does the LLM API actually work?

**What I Should Have Done**:
1. Test LLM API directly first (simple prompt/response)
2. Verify API key is valid and has credits
3. Check network connectivity to Anthropic
4. Then debug agent integration

**Lint**: ⚠️ Always test the most fundamental dependency first (LLM API) before debugging complex integrations

---

### 3. **Changing Function Signatures Without Updating Tests**
**Mistake**: Changed `buildSdp()` from `buildSdp(ip, port, codecs)` to `buildSdp(options)` but didn't immediately update tests, causing 4 test failures.

**Why Wrong**:
- Tests should be updated atomically with code changes
- Broken tests hide real issues
- Creates confusion about what's actually working

**Correct Approach**:
- Update tests in the same commit as API changes
- Run tests immediately after refactoring
- Use TypeScript to catch signature mismatches

**Lint**: ⚠️ Never commit code changes without updating corresponding tests

---

### 4. **Over-Engineering Initial Agent Setup**
**Mistake**: Created complex agent initialization with explicit state fields:
```typescript
initialState: {
  systemPrompt: SYSTEM_PROMPT,
  model,
  thinkingLevel: undefined,
  tools,
  messages: [],
  isStreaming: false,
  streamMessage: null,
  pendingToolCalls: new Set()
}
```

**Reality**: Only needed:
```typescript
initialState: {
  systemPrompt: SYSTEM_PROMPT,
  model,
  tools,
  messages: []
}
```

**Learning**: Start minimal, add complexity only when needed. The framework handles most state internally.

**Lint**: ⚠️ Don't pre-optimize or add fields "just in case" - YAGNI principle

---

### 5. **Not Reading Documentation First**
**Mistake**: Tried to use `agent.chat()` and `agent.on()` methods that don't exist, instead of reading the actual API (`agent.prompt()` and `agent.subscribe()`).

**Time Wasted**: ~15 minutes debugging non-existent methods

**Correct Approach**:
- Read README/docs first
- Check type definitions
- Look at examples in node_modules
- Then implement

**Lint**: ⚠️ Read the actual API documentation before assuming method names

---

### 6. **Readline Interface Handling**
**Mistake**: Set `terminal: false` which caused readline to close immediately on piped input.

**Learning**: 
- Understand the difference between TTY and non-TTY input
- Test both interactive and piped input modes
- Handle EOF gracefully

**Correct Pattern**:
```typescript
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
  // Let readline auto-detect terminal mode
});

rl.on('close', () => {
  console.log('\nGoodbye!');
  process.exit(0);
});
```

**Lint**: ⚠️ Don't override default behavior unless you understand the implications

---

### 7. **Socket Cleanup Race Conditions**
**Mistake**: Called `socket.close()` multiple times, causing "ERR_SOCKET_DGRAM_NOT_RUNNING" errors in tests.

**Fix**: Added cleanup flag:
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

**Learning**: Network resources need careful cleanup, especially in error paths.

**Lint**: ⚠️ Always guard resource cleanup with flags or try-catch

---

### 8. **URL Parsing for SIP URIs**
**Mistake**: Used `new URL(config.uri)` which doesn't properly parse SIP URIs (not HTTP).

**Correct**: Use regex for SIP URI parsing:
```typescript
const uriMatch = config.uri.match(/^sips?:(?:([^@]+)@)?([^:;?]+)(?::(\d+))?/);
const domain = uriMatch[2];
const port = uriMatch[3] ? parseInt(uriMatch[3]) : 5060;
```

**Lint**: ⚠️ Don't assume URL() works for all URI schemes - SIP is not HTTP

---

## What Went Right

### 1. **Layered Architecture**
- Clear separation: skills → sip → network → validation
- Each layer has single responsibility
- Easy to test in isolation

### 2. **Zod as Single Source of Truth**
- Schemas defined once, types inferred
- Validation at every boundary
- Caught errors early

### 3. **Async Generators for Streaming**
- Clean pattern for real-time events
- No callback hell
- Easy to consume in tests and TUI

### 4. **Real Integration Tests**
- No mocks for LiveKit tests
- Tests actual network behavior
- Caught real issues (socket cleanup, timeouts)

### 5. **Circular Buffer Pattern**
- Simple, efficient
- Prevents memory leaks
- Easy to test

---

## Architecture Decisions That Worked

1. **SQLite with FTS5**: Perfect for queryable test history
2. **TypeBox for Agent Tools**: Required by pi-agent-core, worked well
3. **Zod for Everything Else**: Better DX than TypeBox
4. **UDP Sockets**: Direct control, no library overhead
5. **Standalone CLI**: Not a pi extension - simpler deployment

---

## Key Principles Learned

1. **Test Through the Real Interface**: Never bypass the TUI to "prove" things work
2. **Test Fundamentals First**: LLM API before agent integration
3. **Update Tests Atomically**: Code changes and test updates together
4. **Start Minimal**: Add complexity only when needed
5. **Read Docs First**: Don't assume API method names
6. **Guard Resource Cleanup**: Flags and try-catch for network resources
7. **Domain-Specific Parsing**: Don't use HTTP tools for SIP URIs
8. **Real Integration Tests**: No mocks for network testing

---

## Metrics

- **Total Time**: ~3 hours
- **Lines of Code**: ~1,700 (src) + ~800 (tests)
- **Tests**: 49 passing in 11 seconds
- **Test Coverage**: Unit + Integration + E2E
- **Real Network Tests**: LiveKit Cloud endpoints
- **Zero Mocks**: For integration tests

---

## If I Did This Again

1. ✅ Test LLM API first (simple curl/script)
2. ✅ Write TUI integration test before implementation
3. ✅ Read pi-agent-core README completely
4. ✅ Use regex for SIP URI parsing from start
5. ✅ Add socket cleanup guards immediately
6. ✅ Update tests in same commit as code changes
7. ✅ No throwaway test scripts - only proper tests
8. ✅ Verify through TUI first, always

---

## Tools & Patterns to Reuse

- **Circular Buffer**: Perfect for event streams
- **Async Generator Pattern**: Clean streaming
- **Zod + TypeScript**: Type safety + validation
- **SQLite + FTS5**: Queryable storage
- **Real Integration Tests**: No mocks for network
- **Layered Architecture**: Clear boundaries
- **Socket Cleanup Pattern**: Flag-based guards

---

## Anti-Patterns to Avoid

- ❌ Testing through throwaway scripts
- ❌ Bypassing the primary interface
- ❌ Assuming API method names
- ❌ Changing signatures without updating tests
- ❌ Over-engineering initial setup
- ❌ Using wrong parsers (URL for SIP)
- ❌ Unguarded resource cleanup
- ❌ Setting config options without understanding them
