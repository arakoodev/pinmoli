# Implementation Plan - Pinmoli: Standalone SIP Testing Agent

## Problem Statement
Build Pinmoli as a **standalone SIP testing agent** using pi libraries (`@mariozechner/pi-agent-core`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`), similar to how OpenClaw is built on top of pi. This is a specialized, domain-specific tool for SIP/WebRTC testing with natural language interface.

## Architecture Decision

**Pinmoli = Standalone Tool (like OpenClaw)**
- Uses pi's libraries as foundation
- NOT a pi extension
- Dedicated `pinmoli` command
- Own TUI, configuration, and session management
- OpenClaw-style tool restrictions (SIP-domain only)

### Why Standalone?
- **Focused UX**: Dedicated SIP testing interface, not mixed with coding
- **Domain restrictions**: Can enforce SIP-only tools (no file/bash access)
- **Independent lifecycle**: Own sessions, config, and storage
- **Clear separation**: Voice testing ≠ code editing

## Requirements

### Functional
- Natural language interface: "Test sip:agent@livekit.example.com with opus"
- AI-powered debugging: Analyze SIP failures, suggest fixes
- Interactive TUI with real-time SIP event timeline
- Persistent storage for test collections and history
- Session management (save/resume conversations)

### Non-Functional
- **Domain-locked**: Only SIP/RTP/WebRTC operations
- **No file system access** (except `~/.pinmoli/`)
- **No shell execution** (pure Node.js SIP operations)
- **Tool restrictions**: OpenClaw-style allowlist (SIP tools only)
- **Type-safe**: TypeBox schemas (pi uses TypeBox, not Zod)

## Background

### Pi Architecture (from research)
- **pi-mono**: Monorepo with reusable packages
- **@mariozechner/pi-agent-core**: Agent runtime (tool execution, event streaming)
- **@mariozechner/pi-tui**: Terminal UI components (TUI, Editor, Box, Text)
- **@mariozechner/pi-ai**: Unified LLM API (multi-provider, streaming, tool calling)

### How Pi Extensions Work
Extensions are TypeScript functions:
```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function myExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "my_tool",
    description: "What this tool does",
    parameters: Type.Object({ arg: Type.String() }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: "Result for LLM" }],
        details: { /* structured data for UI */ }
      };
    }
  });
}
```

### How OpenClaw Constrains Tools
OpenClaw uses `openclaw.json` for tool restrictions:
```json
{
  "tools": {
    "profile": "minimal",
    "allow": ["group:fs"],
    "deny": ["group:runtime", "exec", "bash"],
    "byProvider": {
      "google-antigravity": { "profile": "minimal" }
    }
  }
}
```

**Tool groups:**
- `group:runtime`: exec, bash, process
- `group:fs`: read, write, edit, apply_patch
- `group:web`: web_search, web_fetch
- `group:ui`: browser, canvas

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Pinmoli CLI (standalone)                   │
│  $ pinmoli                                              │
│  $ pinmoli --model claude-sonnet-4-5 --continue         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│         Pi Libraries (from pi-mono)                     │
│  - @mariozechner/pi-agent-core (agent loop)             │
│  - @mariozechner/pi-tui (TUI components)                │
│  - @mariozechner/pi-ai (LLM API)                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│         Tool Registry (SIP-only, allowlist)             │
│  ✓ sip_test                                             │
│  ✓ analyze_failure                                      │
│  ✓ save_test                                            │
│  ✓ load_test                                            │
│  ✓ list_tests                                           │
│  ✗ read, write, edit (blocked)                          │
│  ✗ exec, bash (blocked)                                 │
│  ✗ web_search, web_fetch (blocked)                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│         SIP Protocol Layer                              │
│  - UDP/TCP/TLS transport                                │
│  - SIP message building                                 │
│  - SDP generation/parsing                               │
│  - RTP handling                                         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│         Storage (SQLite)                                │
│  ~/.pinmoli/pinmoli.db                                  │
│  - test_collections (saved tests)                       │
│  - test_history (execution results)                     │
│  - sessions (conversation history)                      │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **TypeBox (not Zod)**: Pi uses TypeBox for schemas, so we must too
2. **Tool Allowlist**: Only SIP tools registered, no way to add others
3. **Streaming**: SIP engine uses async generators → pi-agent-core events
4. **Storage**: SQLite for persistence (test collections + sessions)
5. **Configuration**: `~/.pinmoli/config.json` (follows pi pattern)

## Task Breakdown

### Task 1: Set up pi dependencies and project structure
**Objective:** Create standalone package with pi libraries

**Implementation:**
- Add to `packages/pinmoli/package.json`:
  ```json
  {
    "name": "@nishirlabs/pinmoli",
    "version": "0.1.0",
    "type": "module",
    "bin": { "pinmoli": "./dist/cli.js" },
    "dependencies": {
      "@mariozechner/pi-agent-core": "^0.50.0",
      "@mariozechner/pi-tui": "^0.50.0",
      "@mariozechner/pi-ai": "^0.50.0",
      "@sinclair/typebox": "^0.32.0",
      "better-sqlite3": "^11.0.0"
    }
  }
  ```
- Create `src/cli.ts` as entry point
- Configure TypeScript for ESM + pi imports

**Test:** `npm install` succeeds, can import pi libraries

**Demo:** Run `pinmoli`, verify it starts (even if empty)

---

### Task 2: Convert Zod schemas to TypeBox
**Objective:** Replace all Zod schemas with TypeBox (pi requirement)

**Implementation:**
- Create `src/validation/schemas.ts`:
  ```typescript
  import { Type, Static } from "@sinclair/typebox";
  
  export const SipEventSchema = Type.Object({
    type: Type.Union([
      Type.Literal('sip'),
      Type.Literal('rtp'),
      Type.Literal('diagnostic'),
      Type.Literal('info'),
      Type.Literal('error')
    ]),
    timestamp: Type.Number(),
    message: Type.String(),
    status: Type.Optional(Type.Number()),
    severity: Type.Optional(Type.Union([
      Type.Literal('info'),
      Type.Literal('warning'),
      Type.Literal('error'),
      Type.Literal('fatal')
    ]))
  });
  export type SipEvent = Static<typeof SipEventSchema>;
  
  export const TestConfigSchema = Type.Object({
    uri: Type.String({ pattern: '^sips?:[^;?]+' }),
    method: Type.Union([
      Type.Literal('OPTIONS'),
      Type.Literal('INVITE'),
      Type.Literal('REGISTER')
    ]),
    codecs: Type.Array(Type.Union([
      Type.Literal('opus'),
      Type.Literal('PCMU'),
      Type.Literal('PCMA'),
      Type.Literal('G722')
    ])),
    transport: Type.Union([
      Type.Literal('udp'),
      Type.Literal('tcp'),
      Type.Literal('tls'),
      Type.Literal('auto')
    ])
  });
  export type TestConfig = Static<typeof TestConfigSchema>;
  ```
- Update all existing code to use TypeBox types

**Test:** Schema validation works with TypeBox

**Demo:** Invalid input rejected by TypeBox validation

---

### Task 3: Implement sip_test tool with pi-agent-core
**Objective:** Convert existing sip_test skill to pi tool format

**Implementation:**
- Create `src/tools/sip-test.ts`:
  ```typescript
  import { Type } from "@sinclair/typebox";
  import type { AgentTool } from "@mariozechner/pi-agent-core";
  import { TestConfigSchema } from "../validation/schemas.js";
  
  export const sipTestTool: AgentTool = {
    name: "sip_test",
    description: "Execute a SIP test (OPTIONS, INVITE, or REGISTER)",
    parameters: TestConfigSchema,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const config = params as TestConfig;
      
      // Stream events via onUpdate
      onUpdate({ type: 'info', message: 'Starting SIP test...' });
      
      // Execute SIP test (reuse existing logic)
      const result = await runSipTest(config);
      
      return {
        content: [
          { type: "text", text: `Test completed: ${result.status}` }
        ],
        details: result
      };
    }
  };
  ```

**Test:** Tool registration works, can be called by agent

**Demo:** Agent executes sip_test tool successfully

---

### Task 4: Convert remaining skills to pi tools
**Objective:** Convert analyze_failure, save_test, load_test, list_tests

**Implementation:**
- Create `src/tools/analyze-failure.ts`
- Create `src/tools/save-test.ts`
- Create `src/tools/load-test.ts`
- Create `src/tools/list-tests.ts`
- All follow same pattern as sip_test

**Test:** All 5 tools registered and callable

**Demo:** Agent can use all SIP tools

---

### Task 5: Implement tool allowlist (OpenClaw-style)
**Objective:** Restrict agent to SIP tools only

**Implementation:**
- Create `src/config/tools.ts`:
  ```typescript
  export const ALLOWED_TOOLS = [
    'sip_test',
    'analyze_failure',
    'save_test',
    'load_test',
    'list_tests'
  ];
  
  export function registerTools(agent: Agent) {
    // Only register allowed tools
    agent.registerTool(sipTestTool);
    agent.registerTool(analyzeFailureTool);
    agent.registerTool(saveTestTool);
    agent.registerTool(loadTestTool);
    agent.registerTool(listTestsTool);
    
    // No way to register additional tools
  }
  ```

**Test:** Agent cannot access non-SIP tools

**Demo:** Ask agent to "read a file", verify it has no such tool

---

### Task 6: Implement basic TUI using pi-tui
**Objective:** Create chat interface with pi-tui components

**Implementation:**
- Create `src/ui/tui.ts`:
  ```typescript
  import { TUI, Box, Text, Editor } from "@mariozechner/pi-tui";
  
  export class PinmoliTUI {
    private tui: TUI;
    private messages: Message[] = [];
    
    constructor() {
      this.tui = new TUI();
      this.setupLayout();
    }
    
    private setupLayout() {
      const chatBox = new Box({ title: "Pinmoli - SIP Testing Agent" });
      const editor = new Editor({ placeholder: "Ask me to test a SIP endpoint..." });
      
      this.tui.add(chatBox);
      this.tui.add(editor);
    }
    
    render() {
      this.tui.render();
    }
  }
  ```

**Test:** TUI renders, can type input

**Demo:** Basic chat interface appears

---

### Task 7: Wire agent loop to TUI
**Objective:** Connect pi-agent-core to TUI for full interaction

**Implementation:**
- Create `src/agent/runtime.ts`:
  ```typescript
  import { Agent } from "@mariozechner/pi-agent-core";
  import { getModel } from "@mariozechner/pi-ai";
  
  export class PinmoliAgent {
    private agent: Agent;
    
    constructor(config: Config) {
      const model = getModel(config.provider, config.model);
      
      this.agent = new Agent({
        model,
        systemPrompt: SYSTEM_PROMPT,
        tools: registerTools()
      });
      
      this.agent.on('tool_call', this.handleToolCall);
      this.agent.on('agent_end', this.handleAgentEnd);
    }
    
    async chat(message: string) {
      return await this.agent.send(message);
    }
  }
  ```

**Test:** Agent loop executes, tools are called

**Demo:** Full conversation with tool execution

---

### Task 8: Add session management
**Objective:** Save/resume conversations

**Implementation:**
- Create `src/storage/sessions.ts`:
  ```typescript
  import Database from 'better-sqlite3';
  
  export class SessionStore {
    private db: Database.Database;
    
    constructor(dbPath: string) {
      this.db = new Database(dbPath);
      this.initSchema();
    }
    
    private initSchema() {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          messages TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    }
    
    save(session: Session) { /* ... */ }
    load(sessionId: string): Session { /* ... */ }
  }
  ```

**Test:** Can save and resume sessions

**Demo:** Exit and resume conversation with history

---

### Task 9: Add configuration system
**Objective:** Support `~/.pinmoli/config.json`

**Implementation:**
- Create `src/config/loader.ts`:
  ```typescript
  export const ConfigSchema = Type.Object({
    llm: Type.Object({
      provider: Type.String(),
      model: Type.String()
    }),
    sip: Type.Object({
      defaultPort: Type.Number({ default: 5060 }),
      timeout: Type.Number({ default: 30000 })
    })
  });
  
  export function loadConfig(): Config {
    const configPath = path.join(os.homedir(), '.pinmoli', 'config.json');
    // Load and validate with TypeBox
  }
  ```

**Test:** Config loads from file and env vars

**Demo:** Override model via config file

---

### Task 10: Add CLI argument parsing
**Objective:** Support `pinmoli --model X --continue`

**Implementation:**
- Update `src/cli.ts`:
  ```typescript
  import { parseArgs } from 'node:util';
  
  const { values } = parseArgs({
    options: {
      model: { type: 'string' },
      provider: { type: 'string' },
      continue: { type: 'boolean' },
      session: { type: 'string' },
      help: { type: 'boolean' }
    }
  });
  
  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  ```

**Test:** CLI args parsed correctly

**Demo:** `pinmoli --model claude-sonnet-4-5` works

---

## System Prompt

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

## Agent Interaction Examples

### Example 1: Simple Test
```
$ pinmoli

Pinmoli: Hi! I'm your SIP/WebRTC testing assistant. What would you like to test?

You: Test sip:agent@livekit.example.com with opus codec

Pinmoli: Running SIP OPTIONS test...

[Timeline shows real-time SIP events]

Pinmoli: ✓ Test successful! Server responded with 200 OK in 45ms.
         The server supports opus codec at 48kHz.
         
         Save this test? [y/n]

You: yes, save as livekit-prod

Pinmoli: Saved to ~/.pinmoli/collections
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

## Key Differences from Original Plan

| Original | New (Pi-Based) |
|----------|----------------|
| Custom agent runtime | Use pi-agent-core |
| Custom TUI | Use pi-tui components |
| Custom LLM integration | Use pi-ai |
| Zod schemas | TypeBox schemas (pi requirement) |
| Custom tool format | Pi tool format (AgentTool) |
| No tool restrictions | OpenClaw-style allowlist |

## Success Criteria

- ✅ Standalone `pinmoli` command works
- ✅ Uses pi libraries (agent-core, tui, ai)
- ✅ Only SIP tools available (no file/bash access)
- ✅ Natural language SIP testing works
- ✅ TUI shows conversation + tool execution
- ✅ Sessions can be saved and resumed
- ✅ Configuration via `~/.pinmoli/config.json`

## Out of Scope

- Pi extension support (user chose standalone)
- Multi-agent support (single-purpose tool)
- Web UI (TUI only)
- MCP support (following pi philosophy)
- Dynamic tool loading (hardcoded allowlist)

---

## User Experience Walkthrough

### Installation & Launch

```bash
# Install globally
npm install -g @nishirlabs/pinmoli

# Basic launch
$ pinmoli

# With specific model
$ pinmoli --model claude-sonnet-4-5

# Resume last session
$ pinmoli --continue

# Resume specific session
$ pinmoli --session abc123
```

### Startup Screen

```
┌─────────────────────────────────────────────────────────┐
│ Pinmoli - SIP Testing Agent                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Pinmoli: Hi! I'm your SIP/WebRTC testing assistant.    │
│          What would you like to test?                   │
│                                                         │
│ > _                                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**What's happening:**
- Pi-TUI renders the interface
- Pi-agent-core initializes with SIP tools only
- Pi-ai connects to configured LLM
- SQLite session starts in `~/.pinmoli/pinmoli.db`

### Natural Language Test Request

```
You: Test sip:agent@livekit.example.com with opus codec

┌─────────────────────────────────────────────────────────┐
│ Pinmoli - SIP Testing Agent                            │
├─────────────────────────────────────────────────────────┤
│ You: Test sip:agent@livekit.example.com with opus      │
│                                                         │
│ Pinmoli: I'll run a SIP OPTIONS test for you.          │
│          [Calling sip_test tool...]                     │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ SIP Timeline (Live)                             │   │
│ ├─────────────────────────────────────────────────┤   │
│ │ 13:22:30 → Sending OPTIONS to livekit.example...│   │
│ │ 13:22:30 → DNS resolved: 203.0.113.42          │   │
│ │ 13:22:30 → UDP socket bound to 0.0.0.0:5060    │   │
│ │ 13:22:31 ← Received 200 OK (45ms)               │   │
│ │ 13:22:31 ✓ Server supports: opus/48000         │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ Pinmoli: ✓ Test successful! The server supports opus.  │
│          Would you like to save this test?             │
│                                                         │
│ > _                                                     │
└─────────────────────────────────────────────────────────┘
```

**Flow:**
1. You type natural language → Pi-agent-core sends to LLM
2. LLM decides to call `sip_test` tool → Pi-agent-core executes it
3. SIP test runs → Events stream via async generator
4. Timeline updates in real-time → Circular buffer (max 1000 events)
5. Results shown → Agent interprets and responds

### Saving Tests (SQLite)

```
You: yes, save as livekit-prod

Pinmoli: [Calling save_test tool...]
         ✓ Saved to ~/.pinmoli/pinmoli.db
         Collection: livekit-prod
```

**What happens:**
```sql
-- Saved to test_collections table
INSERT INTO test_collections (id, name, config, created_at)
VALUES ('uuid', 'livekit-prod', '{"uri":"sip:agent@..."}', 1740214950);

-- Saved to test_history table
INSERT INTO test_history (id, config, result, status_code, timestamp)
VALUES ('uuid', '{"uri":"sip:agent@..."}', '{"events":[...]}', 200, 1740214950);

-- FTS5 index updated for search
```

### Loading Saved Tests

```
You: run the livekit-prod test again

Pinmoli: [Calling load_test tool...]
         Found: livekit-prod
         [Calling sip_test tool...]
         
         ✓ Test passed! Response time: 42ms
         (3ms faster than last run)
```

**What happens:**
- `load_test` queries: `SELECT * FROM test_collections WHERE name = 'livekit-prod'`
- Returns config to agent
- Agent calls `sip_test` with loaded config
- Compares with previous results from `test_history`

### Listing Tests

```
You: show me all my saved tests

Pinmoli: You have 3 saved tests:

1. livekit-prod
   sip:agent@livekit.example.com
   Last run: 2 minutes ago (200 OK)

2. twilio-trunk
   sip:+15551234567@pstn.twilio.com
   Last run: 1 hour ago (200 OK)

3. asterisk-local
   sip:1000@192.168.1.100
   Last run: yesterday (401 Unauthorized)
```

**What happens:**
- `list_tests` queries: `SELECT * FROM test_collections ORDER BY created_at DESC`
- Joins with `test_history` to show last result

### Analyzing Failures

```
You: why did the asterisk test fail?

Pinmoli: [Calling load_test tool...]
         [Calling analyze_failure tool...]
         
         The test failed with 401 Unauthorized.
         
         This means the server requires authentication
         but none was provided.
         
         To fix this:
         1. Add username/password to the test config
         2. Or check if the server allows anonymous requests
         
         Would you like me to re-run with credentials?
```

**What happens:**
- Agent loads test from SQLite
- Gets failure events from `test_history`
- Calls `analyze_failure` tool with events
- Tool uses LLM to analyze SIP-specific failure

---

## How Features Work

### Circular Buffer (Timeline)

```typescript
// src/ui/timeline.ts
import { Box, Text } from "@mariozechner/pi-tui";

class TimelineView {
  private events: SipEvent[] = [];
  private maxEvents = 1000;  // Configurable
  
  addEvent(event: SipEvent) {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();  // Remove oldest
    }
    this.render();  // Pi-TUI re-renders
  }
  
  render() {
    return new Box({
      title: "SIP Timeline",
      content: this.events.map(e => 
        new Text(`${formatTime(e.timestamp)} ${e.message}`)
      )
    });
  }
}
```

**UX:**
- Events stream in real-time during test
- Old events automatically removed (keeps memory bounded)
- Scroll up to see history (within 1000 event limit)
- Pi-TUI handles scrolling/rendering

### SQLite Storage Schema

```sql
-- Test collections (saved tests)
CREATE TABLE test_collections (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  config TEXT NOT NULL,  -- JSON: {uri, method, codecs, ...}
  created_at INTEGER NOT NULL
);

-- Test history (execution results)
CREATE TABLE test_history (
  id TEXT PRIMARY KEY,
  collection_id TEXT,
  config TEXT NOT NULL,
  result TEXT,  -- JSON: {events: [...], duration: 45}
  status_code INTEGER,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES test_collections(id)
);

-- Sessions (conversation history)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  messages TEXT NOT NULL,  -- JSON: [{role, content}, ...]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- FTS5 for search
CREATE VIRTUAL TABLE test_collections_fts 
USING fts5(name, config, content=test_collections);
```

**Operations:**
- **Save test**: `INSERT INTO test_collections`
- **Load test**: `SELECT FROM test_collections WHERE name = ?`
- **List tests**: `SELECT FROM test_collections ORDER BY created_at DESC`
- **Search**: `SELECT FROM test_collections_fts WHERE test_collections_fts MATCH ?`
- **Resume session**: `SELECT FROM sessions WHERE id = ?`

### Session Management

```typescript
// src/storage/sessions.ts
class SessionStore {
  save(session: Session) {
    db.prepare(`
      INSERT OR REPLACE INTO sessions (id, messages, updated_at)
      VALUES (?, ?, ?)
    `).run(session.id, JSON.stringify(session.messages), Date.now());
  }
  
  load(sessionId: string): Session {
    const row = db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(sessionId);
    
    return {
      id: row.id,
      messages: JSON.parse(row.messages),
      createdAt: row.created_at
    };
  }
}
```

**UX:**
```bash
# Start new session
$ pinmoli
# ... chat ...
# Exit (auto-saves)

# Resume last session
$ pinmoli --continue

# Resume specific session
$ pinmoli --session abc123
```

### Real-Time Streaming

```typescript
// src/tools/sip-test.ts
export const sipTestTool: AgentTool = {
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Stream events as they happen
    for await (const event of runSipTest(params)) {
      onUpdate(event);  // Pi-agent-core streams to TUI
    }
    
    return { content: [{ type: "text", text: "Test complete" }] };
  }
};

// src/sip/engine.ts
async function* runSipTest(config: TestConfig) {
  yield { type: 'info', message: 'Starting test...' };
  
  const socket = createSocket();
  yield { type: 'info', message: 'Socket created' };
  
  await sendRequest(socket, config);
  yield { type: 'sip', message: 'Request sent' };
  
  const response = await waitForResponse(socket);
  yield { type: 'sip', status: response.status, message: '200 OK' };
}
```

**UX:**
- Events appear in timeline as they happen
- No waiting for test to complete
- Can see exactly what's happening (DNS, socket, SIP messages)

---

## What Changed from Original Plan

| Feature | Old Plan | New Plan (Pi-Based) |
|---------|----------|---------------------|
| **Launch** | Custom CLI | `pinmoli` (uses pi-agent-core) |
| **Interface** | Custom TUI | Pi-TUI components |
| **Chat** | Custom agent loop | Pi-agent-core handles it |
| **Tools** | Custom format | Pi AgentTool format |
| **Streaming** | Custom implementation | Pi-agent-core events |
| **Storage** | SQLite (same) | SQLite (same) |
| **Timeline** | Circular buffer (same) | Circular buffer (same) |
| **Sessions** | Custom (same) | Pi-agent-core + SQLite |

**What Changed:**
- Runtime: Use pi's agent loop instead of custom
- TUI: Use pi's components instead of custom
- LLM: Use pi-ai instead of custom integration

**What Stayed the Same:**
- SQLite storage (test collections, history)
- Circular buffer for timeline
- SIP protocol layer
- Tool restrictions (SIP-only)

**Key Insight:** The UX is identical to the original plan, but implementation uses pi's battle-tested infrastructure instead of building our own.
