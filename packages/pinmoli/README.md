# Pinmoli - SIP/WebRTC Testing Plugin for Pi

Minimal pi plugin providing 5 SIP/WebRTC testing tools.

## What It Is

Just 5 tools for pi-agent-core:
1. `sip_test` - Execute SIP tests
2. `analyze_failure` - Analyze failures  
3. `save_test` - Save configurations
4. `load_test` - Load configurations
5. `list_tests` - List all tests

## Installation

```bash
cd packages/pinmoli
npm install
npm run build
```

## Usage

The pi framework handles everything. Just use the tools:

```
> test sip:5eezfwavhxe.sip.livekit.cloud with OPTIONS
> save this test as "health-check"
> list my saved tests
```

## Architecture

```
Pi Framework (handles TUI, agent, interaction)
  ↓
Pinmoli Tools (5 hardcoded skills)
  ↓
SIP Transport (UDP)
  ↓
Storage (SQLite)
```

## What We DON'T Do

- ❌ Custom TUI (pi handles it)
- ❌ Custom agent runtime (pi-agent-core handles it)
- ❌ Custom config management (pi handles it)
- ❌ Custom UI components (pi-tui handles it)

## What We DO

- ✅ 5 SIP testing tools
- ✅ SIP protocol implementation
- ✅ SQLite storage for tests
- ✅ Zod validation

## Files

```
src/
├── index.ts              # Minimal entry point
├── agent/runtime.ts      # Agent creation (uses pi-agent-core)
├── skills/               # 5 tools
├── sip/                  # SIP protocol
├── storage/              # SQLite
└── validation/           # Zod schemas
```

## Testing

```bash
npm test  # 35 tests
```

## License

MIT
