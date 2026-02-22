# Pinmoli Skills Reference

Complete reference for all 5 Pinmoli tools. Use these for SIP/WebRTC protocol testing.

**Note:** These tools use standard SIP protocol (RFC 3261) and work with any compliant SIP endpoint. No service-specific APIs or credentials required.

## Tool 1: `sip_test`

Execute SIP protocol tests against endpoints.

### Purpose
Test SIP endpoints with standard SIP methods (OPTIONS, INVITE, REGISTER) to verify connectivity, capability negotiation, and protocol compliance.

### Parameters

```typescript
{
  endpoint: string;    // Required: SIP URI (e.g., "sip:endpoint.example.com")
  method: string;      // Required: "OPTIONS" | "INVITE" | "REGISTER"
  timeout?: number;    // Optional: Timeout in ms (default: 5000)
}
```

### Examples

**Health Check (OPTIONS):**
```json
{
  "endpoint": "sip:pbx.example.com",
  "method": "OPTIONS"
}
```

**Call Setup Test (INVITE):**
```json
{
  "endpoint": "sip:pbx.example.com",
  "method": "INVITE",
  "timeout": 10000
}
```

**Registration Test:**
```json
{
  "endpoint": "sip:pbx.example.com",
  "method": "REGISTER"
}
```

### Response Format

```typescript
{
  success: boolean;
  testId: string;           // UUID for this test
  endpoint: string;
  method: string;
  timestamp: string;        // ISO 8601
  duration: number;         // milliseconds
  statusCode?: number;      // SIP status code (e.g., 200, 404)
  statusText?: string;      // SIP status text (e.g., "OK")
  events: Array<{
    type: string;           // "request_sent" | "response_received" | "timeout" | "error"
    timestamp: string;
    message: string;
    status?: number;
    details?: any;
  }>;
  error?: string;
}
```

### Common Status Codes
- `200 OK` - Success
- `100 Trying` - Processing (INVITE)
- `180 Ringing` - Call ringing (INVITE)
- `404 Not Found` - Endpoint not found
- `408 Request Timeout` - No response
- `503 Service Unavailable` - Server error

---

## Tool 2: `analyze_failure`

Analyze failed SIP tests and provide diagnostic insights.

### Purpose
Examine failed test results, identify root causes, and suggest remediation steps.

### Parameters

```typescript
{
  testId: string;    // Required: UUID of the failed test
}
```

### Example

```json
{
  "testId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Response Format

```typescript
{
  testId: string;
  analysis: {
    rootCause: string;           // Primary failure reason
    diagnostics: string[];       // Detailed diagnostic messages
    recommendations: string[];   // Suggested fixes
    relatedTests?: string[];     // Similar test IDs
  };
  testDetails: {
    endpoint: string;
    method: string;
    timestamp: string;
    error: string;
    events: Array<any>;
  };
}
```

### Common Failure Patterns

**Network Issues:**
- Timeout errors → Check firewall, network connectivity
- Connection refused → Verify endpoint is running
- DNS resolution failure → Check endpoint hostname

**Protocol Issues:**
- 404 Not Found → Endpoint doesn't exist
- 403 Forbidden → Authentication required
- 503 Service Unavailable → Server overloaded or down

**Configuration Issues:**
- Invalid SDP → Check codec support
- Port conflicts → Another process using port 5060
- Malformed SIP URI → Verify endpoint format

---

## Tool 3: `save_test`

Save a test configuration for later reuse.

### Purpose
Store frequently used test configurations with descriptive names for quick access.

### Parameters

```typescript
{
  name: string;        // Required: Unique identifier (alphanumeric, hyphens, underscores)
  endpoint: string;    // Required: SIP URI
  method: string;      // Required: "OPTIONS" | "INVITE" | "REGISTER"
  timeout?: number;    // Optional: Timeout in ms
}
```

### Examples

**Save Health Check:**
```json
{
  "name": "daily-health-check",
  "endpoint": "sip:pbx.example.com",
  "method": "OPTIONS"
}
```

**Save Load Test:**
```json
{
  "name": "pbx-load-test",
  "endpoint": "sip:pbx.example.com",
  "method": "INVITE",
  "timeout": 15000
}
```

### Response Format

```typescript
{
  success: boolean;
  name: string;
  message: string;    // Confirmation message
}
```

### Naming Rules
- Alphanumeric characters, hyphens, underscores only
- Must be unique (will fail if name exists)
- Case-sensitive
- Max length: 255 characters

---

## Tool 4: `load_test`

Load and execute a previously saved test configuration.

### Purpose
Run saved tests without re-specifying parameters. Useful for regression testing and monitoring.

### Parameters

```typescript
{
  name: string;    // Required: Name of saved test
}
```

### Example

```json
{
  "name": "daily-health-check"
}
```

### Response Format

Same as `sip_test` - executes the test and returns full test results.

### Error Cases
- Test name not found → Returns error with list of available tests
- Test configuration invalid → Returns validation error

---

## Tool 5: `list_tests`

List all saved test configurations.

### Purpose
View all saved tests with their configurations and metadata.

### Parameters

None - this tool takes no parameters.

### Example

```json
{}
```

### Response Format

```typescript
{
  tests: Array<{
    name: string;
    endpoint: string;
    method: string;
    timeout: number;
    createdAt: string;      // ISO 8601
    lastRun?: string;       // ISO 8601 of last execution
    runCount: number;       // Number of times executed
  }>;
  total: number;
}
```

### Example Response

```json
{
  "tests": [
    {
      "name": "daily-health-check",
      "endpoint": "sip:pbx.example.com",
      "method": "OPTIONS",
      "timeout": 5000,
      "createdAt": "2026-02-22T10:30:00Z",
      "lastRun": "2026-02-22T11:15:00Z",
      "runCount": 42
    },
    {
      "name": "pbx-registration",
      "endpoint": "sip:pbx.example.com",
      "method": "REGISTER",
      "timeout": 5000,
      "createdAt": "2026-02-22T09:00:00Z",
      "runCount": 0
    }
  ],
  "total": 2
}
```

---

## Usage Patterns

### Basic Testing Workflow

1. **Test an endpoint:**
   ```
   Use sip_test with endpoint and method
   ```

2. **If test fails:**
   ```
   Use analyze_failure with the testId
   ```

3. **Save successful test:**
   ```
   Use save_test with a descriptive name
   ```

4. **Run saved test later:**
   ```
   Use load_test with the name
   ```

5. **View all saved tests:**
   ```
   Use list_tests
   ```

### Monitoring Workflow

```
1. list_tests → Get all saved tests
2. load_test → Run each test
3. analyze_failure → Investigate any failures
```

### Development Workflow

```
1. sip_test → Test new endpoint
2. Iterate with different methods/timeouts
3. save_test → Save working configuration
4. load_test → Verify saved test works
```

---

## Natural Language Examples

The AI agent can understand natural language requests:

**Testing:**
- "Test sip:endpoint.example.com with OPTIONS"
- "Send an INVITE to sip:pbx.example.com"
- "Check if sip:test.example.com is responding"

**Analysis:**
- "Why did test 550e8400-e29b-41d4-a716-446655440000 fail?"
- "Analyze the last failed test"
- "What went wrong with the test?"

**Management:**
- "Save this test as 'daily-health-check'"
- "Run the 'daily-health-check' test"
- "Show me all saved tests"
- "List my test configurations"

---

## Domain Restrictions

These tools are **strictly limited** to SIP/WebRTC testing:

✅ **Allowed:**
- SIP protocol testing (OPTIONS, INVITE, REGISTER)
- WebRTC signaling analysis
- SDP parsing and validation
- VoIP endpoint testing
- Network diagnostics for SIP/RTP

❌ **Not Allowed:**
- General HTTP/HTTPS requests
- Non-SIP network protocols
- File system operations
- Database operations (except internal storage)
- Any non-VoIP related tasks

---

## Error Handling

All tools return structured errors:

```typescript
{
  success: false;
  error: string;           // Human-readable error message
  code?: string;           // Error code (e.g., "TIMEOUT", "INVALID_ENDPOINT")
  details?: any;           // Additional error context
}
```

### Common Error Codes

- `TIMEOUT` - Request timed out
- `INVALID_ENDPOINT` - Malformed SIP URI
- `NETWORK_ERROR` - Network connectivity issue
- `PROTOCOL_ERROR` - SIP protocol violation
- `NOT_FOUND` - Test or endpoint not found
- `VALIDATION_ERROR` - Invalid parameters

---

## Storage

All test data is stored in SQLite with FTS5 (Full-Text Search):

**Location:** `~/.pinmoli/tests.db`

**Tables:**
- `tests` - Saved test configurations
- `results` - Test execution results
- `events` - Detailed event logs

**Cleanup:**
- Results older than 30 days are automatically archived
- Failed tests are retained longer for analysis
- Storage is automatically managed

---

## Performance

**Typical Response Times:**
- OPTIONS: 50-200ms
- INVITE: 100-500ms (depends on server)
- REGISTER: 100-300ms

**Timeouts:**
- Default: 5000ms
- Recommended for INVITE: 10000ms
- Maximum: 30000ms

**Concurrency:**
- Tools can run in parallel
- Each test uses a unique UDP socket
- Automatic socket cleanup after test completion
