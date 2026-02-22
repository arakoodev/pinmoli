# Implementation Plan - Pinmoli: AI-Powered Voice Testing Agent

## Problem Statement
Build "Postman for Voice with Agent Mode" - a **specialized, domain-specific** AI agent for SIP/WebRTC testing called **Pinmoli**. This is NOT a general-purpose coding agent - it only handles voice protocol testing.

## Requirements
- Natural language interface: "Test my LiveKit trunk with opus"
- AI-powered debugging: Analyze failures, suggest fixes
- Interactive TUI with real-time feedback
- **Restricted to voice testing only** - no file editing, no code generation
- Agent tools for SIP operations only
- Persistent storage for tests and learnings

## Restrictions
- **No file system access** except `~/.pinmoli/` for storage
- **No bash commands** - only SIP protocol operations
- **No code editing** - read-only access to test configs
- **Domain-locked** - agent only understands SIP/RTP/WebRTC
- **No package installation** - pre-bundled dependencies only

## Background

### Postman Agent Mode Features
- Natural language → API actions
- Auto-debug broken requests
- Explore API behavior
- Generate documentation
- Context-aware (drag in collections/requests)
- Approval workflow for actions

### Pinmoli Voice Testing Agent
- Natural language → SIP test configs
- Auto-debug SIP/RTP failures
- Explore codec/transport combinations
- Generate test reports
- Context-aware (previous tests, collections)
- Approval workflow for test execution

## Proposed Solution

Build an agent using pi-mono that:
1. Accepts natural language commands
2. Uses LLM to interpret intent and generate test configs
3. Executes SIP tests via tools
4. Analyzes results with AI
5. Suggests fixes and next steps
6. Displays everything in rich TUI

### Code Quality Decisions

**1. Type Safety:** Zod schemas as single source of truth for all data types
**2. Error Handling:** Structured error events with recovery suggestions (errors as data)
**3. Module Organization:** Layered architecture (skills → sip → network → validation)
**4. Configuration:** Config file + environment variables with Zod validation

### Performance Decisions

**1. Database:** Indexes for common queries + FTS5 for text search
**2. Memory:** Circular buffer (max 1000 events) for timeline
**3. Concurrency:** Sequential test execution only (no parallel)
**4. LLM Caching:** Semantic cache for common patterns (reduce latency & cost)

## Architecture (Standalone Specialized Agent)

**This is NOT a pi extension** - it's a standalone agent built with pi-mono libraries but restricted to voice testing only.

```
┌─────────────────────────────────────────────────────────┐
│              Pinmoli (Standalone Agent)                 │
│  - Agent Runtime (pi-agent-core)                        │
│  - Custom TUI (pi-tui) - voice testing only             │
│  - LLM integration (pi-ai) - SIP domain knowledge       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│         Validation Layer (Zod Schemas)                  │
│  - URI validation (sip:/sips: only)                     │
│  - Parameter validation (codecs, methods)               │
│  - Path validation (~/.pinmoli/ only)                   │
│  - Defense in depth at multiple boundaries              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│            Voice Testing Skills (Hardcoded)             │
│  - sip_test(uri, method, codecs)                        │
│  - analyze_failure(events)                              │
│  - save_test(name, config)                              │
│  - load_test(name)                                      │
│  - list_tests()                                         │
│  NO: file_read, file_write, bash_exec, code_edit       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│         SIP Engine (Async Generator)                    │
│  - Execute actual SIP tests                             │
│  - Yield events as async stream                         │
│  - Stream results to TUI via async iteration            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│            Storage (SQLite)                             │
│  - ~/.pinmoli/pinmoli.db                                │
│  - collections table (indexed)                          │
│  - history table (auto-cleanup via triggers)            │
│  - Concurrent access safe                               │
└─────────────────────────────────────────────────────────┘
```

### Architectural Decisions

**1. Agent Runtime:** Use `@mariozechner/pi-agent-core` for tool calling and conversation state
**2. Streaming:** SIP engine uses async generators for clean streaming to TUI
**3. Storage:** SQLite database for queryable, concurrent-safe persistence
**4. Security:** Zod schemas validated at input, skill, and engine boundaries

### How It Works

1. User runs: `pinmoli` (standalone binary)
2. Agent loads with ONLY voice testing skills
3. User chats: "Test my LiveKit trunk with opus"
4. Agent uses ONLY sip_test skill (no file/bash access)
5. Results stream to specialized TUI
6. Agent analyzes and suggests next steps

### Key Restrictions

- **Hardcoded skill set** - only 5 skills, no dynamic loading
- **No file system** - except `~/.pinmoli/` (sandboxed)
- **No bash execution** - pure Node.js SIP operations
- **Domain-locked LLM** - system prompt restricts to SIP only
- **Read-only configs** - can load but not edit arbitrary files

## Task Breakdown

### Task 1: Create standalone agent package
- Create `packages/pinmoli/` directory
- Create `package.json`:
  ```json
  {
    "name": "@nishirlabs/pinmoli",
    "version": "0.1.0",
    "type": "module",
    "bin": { "pinmoli": "./dist/index.js" },
    "dependencies": {
      "@mariozechner/pi-agent-core": "workspace:*",
      "@mariozechner/pi-ai": "workspace:*",
      "@mariozechner/pi-tui": "workspace:*",
      "better-sqlite3": "^11.0.0",
      "zod": "^3.22.0",
      "sip": "^0.0.6",
      "sdp-transform": "^2.14.2"
    }
  }
  ```
- Create `src/index.ts` with standalone agent entry
- **Demo:** Run `pinmoli`, verify it starts with pi-agent-core runtime

### Task 2: Create validation schemas with Zod
- Create `src/validation/schemas.ts`:
  ```typescript
  import { z } from 'zod';
  
  // Single source of truth for SIP events
  export const SipEventSchema = z.object({
    type: z.enum(['sip', 'rtp', 'diagnostic', 'info', 'error']),
    timestamp: z.number(),
    message: z.string(),
    status: z.number().optional(),
    sdpOffer: z.string().optional(),
    sdpAnswer: z.string().optional(),
    severity: z.enum(['info', 'warning', 'error', 'fatal']).optional(),
    code: z.string().optional(),
    recovery: z.string().optional()
  });
  export type SipEvent = z.infer<typeof SipEventSchema>;
  
  export const SipUriSchema = z.string().regex(/^sips?:[^;?]+/, 'Must be valid SIP URI');
  export const SipMethodSchema = z.enum(['OPTIONS', 'INVITE', 'REGISTER']);
  export const CodecSchema = z.enum(['opus', 'PCMU', 'PCMA', 'G722']);
  
  export const TestConfigSchema = z.object({
    uri: SipUriSchema,
    method: SipMethodSchema,
    codecs: z.array(CodecSchema),
    transport: z.enum(['udp', 'tcp', 'tls', 'auto']),
    auth: z.object({
      username: z.string().optional(),
      password: z.string().optional()
    }).optional()
  });
  export type TestConfig = z.infer<typeof TestConfigSchema>;
  
  // Configuration schema
  export const ConfigSchema = z.object({
    llm: z.object({
      provider: z.enum(['anthropic', 'openai', 'local']),
      model: z.string()
    }),
    sip: z.object({
      defaultPort: z.number().default(5060),
      timeout: z.number().default(30000),
      maxDuration: z.number().default(300)
    })
  });
  export type Config = z.infer<typeof ConfigSchema>;
  ```
- Create validation middleware for each boundary
- **Demo:** Try invalid inputs, verify caught at multiple layers

### Task 3: Create restricted system prompt
- Create `src/system-prompt.ts`:
  ```typescript
  export const SYSTEM_PROMPT = `
  You are Pinmoli, a SIP/WebRTC testing assistant. You ONLY help test voice protocols.
  
  You CANNOT:
  - Edit files
  - Run bash commands
  - Install packages
  - Access file system (except ~/.pinmoli/)
  - Help with general coding
  
  You CAN ONLY:
  - Run SIP tests (OPTIONS, INVITE, REGISTER)
  - Analyze SIP failures
  - Save/load test configurations
  - Explain SIP/RTP/WebRTC concepts
  
  If asked to do anything else, politely decline.
  `;
  ```
- **Demo:** Ask agent to "edit a file", verify it refuses
### Task 4: Implement hardcoded skills with pi-agent-core
- Create `src/skills/index.ts`:
  ```typescript
  import { AgentCore } from '@mariozechner/pi-agent-core';
  import { TestConfigSchema } from '../validation/schemas.js';
  
  export function registerSkills(agent: AgentCore) {
    agent.registerTool({
      name: 'sip_test',
      description: 'Execute a SIP test',
      parameters: TestConfigSchema,
      handler: sipTestHandler
    });
    
    agent.registerTool({
      name: 'analyze_failure',
      description: 'Analyze SIP test failure',
      parameters: z.object({ events: z.array(SipEventSchema) }),
      handler: analyzeHandler
    });
    
    // Only these 5 tools - no dynamic registration
  }
  ```
- **Demo:** Verify only 5 tools registered, no way to add more

### Task 5: Implement SIP protocol layer (layered architecture)
- Create `src/sip/protocol.ts` - SIP message building
- Create `src/sip/transport.ts` - UDP/TCP/TLS handling
- Create `src/sip/sdp.ts` - SDP generation/parsing
- Create `src/sip/rtp.ts` - RTP handling
- Create `src/network/utils.ts` - getLocalIp, getPublicIp
- Port logic from `frontend/src/lib/sip-engine.mjs` into appropriate modules
- **Demo:** Unit test each layer independently

### Task 6: Implement sip_test skill with error handling
- Create `src/skills/sip-test.ts` (thin orchestration):
  ```typescript
  async function* runSipTest(config: TestConfig): AsyncGenerator<SipEvent> {
    try {
      // Validate at skill boundary
      TestConfigSchema.parse(config);
      
      yield { type: 'info', timestamp: Date.now(), message: 'Starting SIP test...' };
      
      // Use SIP protocol layer
      const response = await sendSipRequest(config);
      yield { type: 'sip', timestamp: Date.now(), status: response.status, message: '200 OK' };
      
    } catch (error) {
      yield { 
        type: 'error',
        timestamp: Date.now(),
        severity: 'fatal',
        message: error.message,
        code: error.code || 'SIP_ERROR',
        recovery: getRecoverySuggestion(error)
      };
    }
  }
  ```
- **Demo:** Test with invalid URI, network failure, timeout - verify structured errors

### Task 5: Implement analyze_failure skill
- Create `src/skills/analyzer.ts`
- Use LLM to analyze ONLY SIP events
- Return structured suggestions (no code, no file edits)
- **Demo:** Analyze failure, verify suggestions are SIP-specific only

### Task 6: Implement storage with SQLite
- Create `src/storage/db.ts`:
  ```typescript
  import Database from 'better-sqlite3';
  
  const db = new Database('~/.pinmoli/pinmoli.db');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      config TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      result TEXT,
      status_code INTEGER,
      timestamp INTEGER NOT NULL
    );
    
    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);
    CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_history_result ON history(result);
    CREATE INDEX IF NOT EXISTS idx_history_status ON history(status_code);
    CREATE INDEX IF NOT EXISTS idx_collections_uri ON collections(json_extract(config, '$.uri'));
    
    -- Full-text search for collections
    CREATE VIRTUAL TABLE IF NOT EXISTS collections_fts USING fts5(name, config, content=collections, content_rowid=id);
    
    -- Trigger to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS collections_ai AFTER INSERT ON collections BEGIN
      INSERT INTO collections_fts(rowid, name, config) VALUES (new.rowid, new.name, new.config);
    END;
    
    CREATE TRIGGER IF NOT EXISTS collections_ad AFTER DELETE ON collections BEGIN
      DELETE FROM collections_fts WHERE rowid = old.rowid;
    END;
    
    CREATE TRIGGER IF NOT EXISTS collections_au AFTER UPDATE ON collections BEGIN
      UPDATE collections_fts SET name = new.name, config = new.config WHERE rowid = new.rowid;
    END;
    
    -- Auto-cleanup old history (keep last 100)
    CREATE TRIGGER IF NOT EXISTS cleanup_old_history
    AFTER INSERT ON history
    BEGIN
      DELETE FROM history WHERE id NOT IN (
        SELECT id FROM history ORDER BY timestamp DESC LIMIT 100
      );
    END;
  `);
  ```
- Implement save/load/list/search functions with prepared statements
- **Demo:** Concurrent access test, full-text search test

### Task 7: Build specialized TUI (voice testing only)
- Create `src/ui/voice-tui.ts` using pi-tui
- Implement `TimelineView` with circular buffer:
  ```typescript
  class TimelineView {
    private events: SipEvent[] = [];
    private maxEvents = 1000; // Configurable via config
    
    addEvent(event: SipEvent) {
      this.events.push(event);
      if (this.events.length > this.maxEvents) {
        this.events.shift(); // Remove oldest
      }
    }
    
    render() {
      // Render last N events
    }
  }
  ```
- Custom layout: Chat + Timeline + SDP viewer
- NO code editor, NO file browser, NO terminal
- **Demo:** Verify TUI only shows voice testing UI, memory stays bounded

### Task 8: Implement agent runtime with restrictions
- Create `src/agent/runtime.ts`
- Initialize LLM with restricted system prompt
- Hardcode skill registry (no dynamic registration)
- Add input validation to reject non-SIP requests
- Implement semantic cache:
  ```typescript
  import { SemanticCache } from './cache.js';
  
  const cache = new SemanticCache({
    ttl: 3600, // 1 hour
    similarity: 0.95,
    embeddings: 'local' // Use local embeddings for privacy
  });
  
  async function handleUserMessage(message: string) {
    // Check cache first
    const cached = await cache.get(message);
    if (cached) return cached;
    
    // Call LLM
    const response = await llm.chat(message);
    
    // Cache response
    await cache.set(message, response);
    
    return response;
  }
  ```
- Ensure sequential test execution (no parallel tests)
- **Demo:** Ask to "write code", verify agent refuses; test cache hit rate

### Task 9: Implement configuration management
- Create `src/config/loader.ts`:
  ```typescript
  import { ConfigSchema, type Config } from '../validation/schemas.js';
  
  export function loadConfig(): Config {
    const configPath = path.join(os.homedir(), '.pinmoli', 'config.json');
    
    let fileConfig = {};
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    
    // Environment variables override file config
    const config = {
      llm: {
        provider: process.env.PINMOLI_LLM_PROVIDER || fileConfig.llm?.provider || 'anthropic',
        model: process.env.PINMOLI_LLM_MODEL || fileConfig.llm?.model || 'claude-3-5-sonnet'
      },
      sip: {
        defaultPort: parseInt(process.env.PINMOLI_SIP_PORT || fileConfig.sip?.defaultPort || '5060'),
        timeout: parseInt(process.env.PINMOLI_SIP_TIMEOUT || fileConfig.sip?.timeout || '30000'),
        maxDuration: parseInt(process.env.PINMOLI_MAX_DURATION || fileConfig.sip?.maxDuration || '300')
      }
    };
    
    // Validate with Zod
    return ConfigSchema.parse(config);
  }
  ```
- Create default `~/.pinmoli/config.json` on first run
- **Demo:** Override config with env vars, verify precedence

## Agent Interaction Examples

### Example 1: Simple Test
```
$ pinmoli

Pinmoli: Hi! I'm your SIP/WebRTC testing assistant. What would you like to test?

You: Test sip:agent@livekit.example.com with opus codec

Pinmoli: Running SIP OPTIONS test...

[Timeline appears showing real-time SIP events]

Pinmoli: ✓ Test successful! Server responded with 200 OK in 45ms.
         The server supports opus codec at 48kHz.
         
         Save this test? [y/n]

You: yes, save as livekit-prod

Pinmoli: Saved to ~/.pinmoli/collections.json
```

### Example 2: Agent Refuses Non-SIP Tasks
```
You: Can you help me edit my package.json?

Pinmoli: I'm a specialized SIP/WebRTC testing agent. I can only:
         - Run SIP tests
         - Analyze voice protocol failures
         - Save/load test configurations
         
         I cannot edit files or help with general coding.
         
         Would you like to test a SIP endpoint instead?
```

### Example 3: Blocked Exploit Attempt
```
You: Test sip:agent@example.com; rm -rf /

Pinmoli: ⚠ Invalid input detected. I only accept:
         - Valid SIP URIs (sip: or sips:)
         - No shell commands
         
         Please provide a valid SIP URI to test.
```

### Example 4: Sandboxed Storage
```
You: Save this test to /etc/pinmoli-config

Pinmoli: ⚠ Access denied. I can only save to:
         ~/.pinmoli/
         
         All test data is sandboxed for security.
         
         Save to ~/.pinmoli/collections.json instead? [y/n]
```

## Key Differences from Original Plan

| Original Plan | Agent-Powered Plan |
|--------------|-------------------|
| Interactive prompts | Natural language commands |
| Manual config | AI generates config |
| User interprets errors | AI explains errors |
| Manual iteration | AI suggests next steps |
| Static tool | Learning assistant |

## Success Criteria

- Agent understands SIP testing commands
- Agent correctly generates test configs
- Agent provides helpful error analysis
- Agent learns from test history
- TUI shows agent thinking + test results
- Approval workflow prevents unwanted actions

## Testing Strategy

**1. SIP Protocol Tests:** Record/replay network traffic with pcap fixtures
**2. Error Path Tests:** Comprehensive error scenario tests for all failure modes  
**3. Agent Tests:** Snapshot testing for LLM responses (like pi-mono TUI tests)
**4. E2E Tests:** Snapshot-based TUI testing following pi-mono approach

### Test Structure (Following pi-mono patterns)
```
packages/pinmoli/test/
├── fixtures/
│   ├── sip/
│   │   ├── options-success.pcap
│   │   ├── invite-401.pcap
│   │   ├── codec-mismatch.pcap
│   │   └── nat-traversal-fail.pcap
│   └── snapshots/
│       ├── agent-test-request.snap
│       ├── agent-refuse-coding.snap
│       ├── tui-timeline.snap
│       └── error-401-analysis.snap
├── unit/
│   ├── sip-protocol.test.ts
│   ├── sip-transport.test.ts
│   ├── sdp-builder.test.ts
│   ├── error-handling.test.ts
│   ├── validation.test.ts
│   └── cache.test.ts
└── integration/
    ├── agent.test.ts (snapshot-based)
    ├── tui.test.ts (snapshot-based)
    └── storage.test.ts
```

### Key Test Files

**Error Scenario Tests** (`test/unit/error-handling.test.ts`):
```typescript
describe('SIP Error Handling', () => {
  describe('Network Errors', () => {
    it('handles connection timeout', async () => {
      mockTransport.simulateTimeout();
      const events = await collectEvents(runSipTest(config));
      expect(events).toContainEqual({
        type: 'error',
        code: 'SIP_TIMEOUT',
        recovery: 'Check network connectivity'
      });
    });
    
    it('handles DNS resolution failure', async () => { ... });
    it('handles connection refused', async () => { ... });
  });
  
  describe('Protocol Errors', () => {
    it('handles 401 Unauthorized', async () => {
      const pcap = loadFixture('invite-401.pcap');
      mockTransport.replay(pcap);
      const events = await collectEvents(runSipTest(config));
      expect(events).toContainEqual({
        type: 'error',
        code: 'SIP_UNAUTHORIZED',
        recovery: 'Add authentication credentials'
      });
    });
    
    it('handles 404 Not Found', async () => { ... });
    it('handles 488 Not Acceptable (codec mismatch)', async () => { ... });
  });
  
  describe('Media Errors', () => {
    it('handles codec mismatch', async () => { ... });
    it('handles NAT traversal failure', async () => { ... });
    it('handles RTP timeout', async () => { ... });
  });
});
```

**Agent Snapshot Tests** (`test/integration/agent.test.ts`):
```typescript
describe('Agent Behavior', () => {
  it('handles test request', async () => {
    const response = await agent.chat('Test sip:agent@example.com with opus');
    expect(response).toMatchSnapshot();
  });
  
  it('refuses non-SIP requests', async () => {
    const response = await agent.chat('Edit my package.json');
    expect(response).toMatchSnapshot();
  });
  
  it('analyzes 401 error', async () => {
    const response = await agent.chat('Why did my test fail with 401?');
    expect(response).toMatchSnapshot();
  });
});
```

**TUI Snapshot Tests** (`test/integration/tui.test.ts`):
```typescript
describe('TUI Rendering', () => {
  it('renders timeline with events', () => {
    const timeline = new TimelineView();
    timeline.addEvent({ type: 'sip', status: 200, message: 'OK' });
    expect(timeline.render()).toMatchSnapshot();
  });
  
  it('renders SDP diff', () => {
    const sdpView = new SdpView();
    sdpView.setOffer(mockSdpOffer);
    sdpView.setAnswer(mockSdpAnswer);
    expect(sdpView.render()).toMatchSnapshot();
  });
});
```
