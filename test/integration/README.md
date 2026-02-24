# Pinmoli TUI Flow Tests

## Overview

Created comprehensive flow tests for Pinmoli's TUI following the pi-mono testing approach. These tests focus on **user interaction flows** rather than implementation details.

## Test Structure

### 1. TUI Flow Tests (`test/integration/tui-flow.test.ts`)
**14 tests** covering basic TUI functionality:
- Initial welcome flow
- Message display (user/assistant/system)
- Real-time streaming
- User input handling
- Multi-turn conversations
- Screen clearing

### 2. End-to-End Flow Tests (`test/integration/e2e-flow.test.ts`)
**12 tests** covering complete system flows:
- Agent + TUI integration
- SIP test workflows (OPTIONS, INVITE, REGISTER)
- Error handling flows (timeout, DNS, invalid URI)
- Multi-step workflows (test → analyze → save)
- Load and re-run workflows
- Real-time streaming during tests

### 3. UI Interaction Patterns (`test/integration/ui-patterns.test.ts`)
**12 tests** covering common user patterns:
- Quick test pattern (simple one-liners)
- Detailed test pattern (verbose output)
- Comparison pattern (multiple servers)
- Troubleshooting pattern (diagnostic workflows)
- Batch testing pattern (multiple URIs)
- Save/load pattern (reusable configs)
- Edge cases (empty messages, long messages, rapid updates)

## Test Philosophy

Following pi-mono's approach:
- ✅ Test **user flows**, not implementation
- ✅ Test **what users see**, not internal state
- ✅ Test **real interaction patterns**
- ✅ Mock stdin/stdout to capture actual output
- ✅ Verify complete workflows end-to-end

## Coverage

**38 integration tests** covering:
- Initial startup and welcome
- Message display and formatting
- Real-time event streaming
- Tool execution visualization
- Error handling and recovery
- Multi-step workflows
- Save/load/list operations
- Comparison and analysis
- Troubleshooting patterns
- Edge cases

## Running Tests

```bash
# All integration tests
npm test -- test/integration/

# Specific test file
npm test -- test/integration/tui-flow.test.ts
npm test -- test/integration/e2e-flow.test.ts
npm test -- test/integration/ui-patterns.test.ts
```

## Test Results

```
Test Files  11 passed (17 total)
Tests       80 passed
```

All TUI flow tests passing ✅

## Example Test

```typescript
it('handles full conversation flow', async () => {
  // Start TUI
  tui.start();
  expect(output.join('')).toContain('Pinmoli');

  // User sends message
  tui.addMessage('user', 'Test sip:example.com with OPTIONS');
  expect(output.join('')).toContain('You: Test sip:example.com');

  // Stream tool execution
  tui.streamMessage('\n[Tool] Executing sip_test...');
  tui.streamMessage('\n  [INFO] Starting test');
  tui.streamMessage('\n  [SIP] Sending OPTIONS');
  tui.streamMessage('\n[Tool] Complete\n');

  // Verify output
  const fullOutput = output.join('');
  expect(fullOutput).toContain('[Tool] Executing sip_test');
  expect(fullOutput).toContain('[SIP] Sending OPTIONS');
});
```

## Key Features Tested

1. **Real-time Streaming**: Events appear progressively as they happen
2. **Message Formatting**: Proper prefixes for user/assistant/system
3. **Tool Visualization**: Clear indication of tool execution
4. **Error Handling**: Graceful display of errors with context
5. **Multi-turn Conversations**: State maintained across turns
6. **Workflow Patterns**: Common user workflows work smoothly

## Next Steps

These tests ensure the TUI provides a good user experience. Future enhancements:
- Add tests for proper pi-tui components (Terminal, Container, Box)
- Add tests for keyboard shortcuts
- Add tests for overlay/modal interactions
- Add tests for session management UI
