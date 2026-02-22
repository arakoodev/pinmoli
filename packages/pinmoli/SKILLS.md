# Pinmoli Skills Reference

## Overview

Pinmoli has exactly **5 hardcoded skills** - no dynamic registration allowed. Each skill is domain-restricted to SIP/WebRTC testing only.

---

## 1. sip_test

Execute SIP protocol tests with real network communication.

### Parameters

```typescript
{
  uri: string;          // SIP URI (sip: or sips:)
  method: 'OPTIONS' | 'INVITE' | 'REGISTER';
  codecs: Array<'opus' | 'PCMU' | 'PCMA' | 'G722'>;
  transport: 'udp' | 'tcp' | 'tls' | 'auto';
  mediaPort?: number;   // Default: 10000
  timeout?: number;     // Default: 5000ms
}
```

### Returns

Async generator yielding `SipEvent` objects:

```typescript
type SipEvent = {
  type: 'sip' | 'rtp' | 'network' | 'diagnostic' | 'info' | 'error';
  timestamp: number;
  message: string;
  method?: string;
  status?: number;
  sdpOffer?: string;
  sdpAnswer?: string;
  severity?: 'info' | 'warning' | 'error' | 'fatal';
  code?: string;
  recovery?: string;
}
```

### Event Flow

1. **network**: DNS resolution
2. **network**: Socket binding
3. **sip**: Request sent (with SDP offer for INVITE)
4. **sip**: Response received (with status code)
5. **error**: If timeout or failure

### Examples

```
> test sip:example.com with OPTIONS

> make an INVITE call to sip:5eezfwavhxe.sip.livekit.cloud using opus codec

> send REGISTER to sip:pbx.company.com with PCMU and PCMA codecs
```

### Implementation

- **File**: `src/skills/sip-test.ts`
- **Transport**: `src/sip/transport.ts` (UDP dgram)
- **SDP Builder**: `src/sip/sdp.ts`
- **Validation**: Zod schema at skill boundary

---

## 2. analyze_failure

Analyze SIP test failures and provide actionable recovery steps.

### Parameters

```typescript
{
  events: SipEvent[];  // Array of events from failed test
}
```

### Returns

```typescript
{
  analysis: string;    // Detailed failure analysis
  errorCode?: string;  // SIP error code if applicable
  recovery: string[];  // List of recovery steps
  commonCauses: string[];
}
```

### Analysis Includes

1. **Error Identification**: What went wrong
2. **SIP Code Interpretation**: Meaning of status codes
3. **Root Cause**: Why it failed
4. **Recovery Steps**: How to fix it
5. **Common Causes**: Typical reasons for this failure

### Examples

```
> analyze the last test failure

> why did that INVITE fail?

> explain the 408 timeout error
```

### Implementation

- **File**: `src/skills/analyzer.ts`
- **Current**: Rule-based analysis
- **TODO**: LLM-powered analysis for complex failures

---

## 3. save_test

Save a test configuration to collections for reuse.

### Parameters

```typescript
{
  name: string;        // Unique collection name
  config: TestConfig;  // Test configuration to save
}
```

### Returns

```typescript
{
  message: string;     // Confirmation message
  id: string;          // Collection ID
}
```

### Storage

- **Location**: `~/.pinmoli/pinmoli.db`
- **Table**: `collections`
- **Constraint**: Unique name (enforced by SQLite)
- **Search**: Full-text search enabled

### Examples

```
> save this test as "production-health-check"

> save current config as "livekit-options"

> store this as "daily-monitoring"
```

### Implementation

- **File**: `src/skills/storage.ts`
- **Database**: `src/storage/db.ts`
- **Validation**: Name uniqueness enforced

---

## 4. load_test

Load a previously saved test configuration.

### Parameters

```typescript
{
  name: string;  // Collection name to load
}
```

### Returns

```typescript
TestConfig | null  // Test configuration or null if not found
```

### Examples

```
> load test "production-health-check"

> run the "livekit-options" test

> use saved test "daily-monitoring"
```

### Implementation

- **File**: `src/skills/storage.ts`
- **Database**: `src/storage/db.ts`
- **Search**: Exact name match or FTS5 search

---

## 5. list_tests

List all saved test configurations.

### Parameters

```typescript
{}  // No parameters
```

### Returns

```typescript
{
  tests: Array<{
    name: string;
    timestamp: number;
    uri: string;
    method: string;
  }>;
}
```

### Examples

```
> list my saved tests

> show all test collections

> what tests do I have?
```

### Implementation

- **File**: `src/skills/storage.ts`
- **Database**: `src/storage/db.ts`
- **Ordering**: Most recent first

---

## Skill Registration

Skills are registered in `src/skills/index.ts` using TypeBox schemas (required by pi-agent-core):

```typescript
export function createTools(): AgentTool[] {
  return [
    {
      name: 'sip_test',
      label: 'SIP Test',
      description: 'Execute a SIP test with the given configuration',
      parameters: Type.Object({
        uri: Type.String({ description: 'SIP URI to test (sip: or sips:)' }),
        method: Type.Union([Type.Literal('OPTIONS'), Type.Literal('INVITE'), Type.Literal('REGISTER')]),
        codecs: Type.Array(Type.String()),
        transport: Type.Union([Type.Literal('udp'), Type.Literal('tcp'), Type.Literal('tls'), Type.Literal('auto')])
      }),
      execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const events = [];
        for await (const event of sipTestHandler(params as never)) {
          events.push(event);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(events, null, 2) }],
          details: { events }
        };
      }
    },
    // ... other 4 tools
  ];
}
```

---

## Domain Restrictions

All skills are **strictly limited** to SIP/WebRTC testing:

### ✅ Allowed Operations
- SIP protocol testing (OPTIONS, INVITE, REGISTER)
- SDP offer/answer negotiation
- Codec negotiation
- Network diagnostics (DNS, socket binding)
- Test configuration management
- Failure analysis

### ❌ Forbidden Operations
- File system access (except `~/.pinmoli/`)
- Bash command execution
- Package installation
- Code editing
- General programming tasks
- Web scraping
- Database operations (except internal storage)

---

## Error Handling

All skills follow the "errors as data" pattern:

```typescript
// Success
yield {
  type: 'sip',
  timestamp: Date.now(),
  status: 200,
  message: '200 OK'
};

// Error
yield {
  type: 'error',
  timestamp: Date.now(),
  message: 'Connection timeout',
  severity: 'fatal',
  code: 'TIMEOUT',
  recovery: 'Check network connectivity and firewall rules'
};
```

No exceptions thrown - all errors are yielded as events.

---

## Testing

Each skill has comprehensive tests:

- **Unit Tests**: Validation, schema parsing
- **Integration Tests**: Real network calls to LiveKit
- **E2E Tests**: Full flow with TUI integration

See `test/integration/` for examples.

---

## Adding New Skills (Not Allowed)

Pinmoli is **intentionally limited to 5 skills**. No dynamic registration.

If you need additional functionality:
1. Extend existing skills
2. Add parameters to existing tools
3. Enhance analysis capabilities

Do NOT:
- Add new tools
- Create dynamic tool registration
- Bypass the 5-tool limit

---

## Skill Execution Flow

```
User Query
    ↓
Agent (Claude 3.5 Sonnet)
    ↓
Tool Selection (1 of 5 skills)
    ↓
Parameter Extraction
    ↓
Zod Validation
    ↓
Skill Execution (async generator)
    ↓
Event Stream (SipEvent[])
    ↓
TUI Display (circular buffer)
    ↓
Storage (SQLite history)
```

---

## Performance

- **sip_test**: ~100-500ms per test (network dependent)
- **analyze_failure**: <10ms (rule-based)
- **save_test**: <5ms (SQLite insert)
- **load_test**: <5ms (SQLite query)
- **list_tests**: <10ms (SQLite query with FTS5)

---

## Monitoring

All skill executions are:
- Logged to history table
- Searchable via FTS5
- Limited to last 100 executions (auto-cleanup)
- Indexed by timestamp, result, status_code, URI

---

## Future Enhancements

Within existing skills:

1. **sip_test**:
   - Add TCP/TLS transport
   - Support authentication (digest)
   - RTP media handling
   - Call termination (BYE/CANCEL)

2. **analyze_failure**:
   - LLM-powered analysis
   - Pattern recognition
   - Historical failure correlation

3. **save_test**:
   - Test suites (multiple tests)
   - Scheduled execution
   - Test templates

4. **load_test**:
   - Fuzzy search
   - Tag-based filtering
   - Version history

5. **list_tests**:
   - Pagination
   - Sorting options
   - Export to JSON

All enhancements must stay within the 5-skill limit and domain restrictions.
