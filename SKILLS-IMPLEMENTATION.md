# Pinmoli Skills - Implementation Summary

## What Was Created

### 1. Personal Skill (Cross-Platform)

**Location:** `~/.claude/skills/pinmoli/`

**Files:**
- `SKILL.md` - Main skill teaching AI how to use Pinmoli
- `README.md` - Documentation for skill structure

**Purpose:** Teaches any AI assistant how to use Pinmoli for SIP/WebRTC testing with speech generation

**Scope:** Available in all projects across all AI tools

**Capabilities:**
- SIP protocol testing (OPTIONS, INVITE, REGISTER)
- Custom speech generation at runtime
- Bidirectional voice conversations with AI agents
- Configurable response wait times
- Audio sample management

**Symlinked to:**
- `~/.config/gemini/skills/pinmoli` → Gemini CLI
- `~/.config/openai/skills/pinmoli` → OpenAI Codex
- `~/.aider/skills/pinmoli` → Aider

### 2. Project Skill (Development)

**Location:** `.claude/skills/pinmoli-dev/`

**Files:**
- `SKILL.md` - Development guide for contributors

**Purpose:** Provides context for AI assistants working on Pinmoli codebase

**Scope:** Only when working in the project root directory

**Behavior:** Background skill (not user-invocable)

## Current Features (v0.1.0)

### Status

**Working:**
- SIP protocol (INVITE, OPTIONS, REGISTER)
- Audio transmission to SIP endpoints
- Speech synthesis and custom audio generation
- Bidirectional call flow (send audio, wait for response, hangup)
- LiveKit integration (calls connect successfully)

**In Progress:**
- RTP audio reception (receiving agent responses)
- Port binding conflicts need resolution
- Network configuration for incoming RTP packets

### 6 Tools Available

1. **sip_test** - Execute SIP tests with speech
   - OPTIONS, INVITE, REGISTER methods
   - Custom audio samples
   - Configurable response wait time (0-60s)
   - Bidirectional conversation support
   - Sends audio to agents successfully

2. **generate_audio** - Create custom audio at runtime
   - Speech synthesis (espeak)
   - Sine wave generation
   - DTMF tones
   - Silence

3. **analyze_failure** - Diagnose test failures
4. **save_test** - Save test configurations
5. **load_test** - Load saved tests
6. **list_tests** - List all saved tests

### Audio Capabilities

**Pre-generated Samples:**
- voice-hello (default) - "Hello, this is a test call from Pinmoli"
- sine-440hz, sine-1000hz - Tone generators
- dtmf-123 - DTMF tones
- silence - Silence

**Runtime Generation:**
- Custom speech from any text
- Custom frequencies (20Hz-20kHz)
- Custom durations (0.1s-30s)
- All output as PCMU @ 8kHz mono

### Bidirectional Conversation

**Flow:**
1. INVITE → 100/180/200 → ACK
2. Send our audio (speech) ✅
3. Wait N seconds for agent response (configurable) ✅
4. Receive agent's RTP audio ⚠️ (in progress)
5. BYE → hangup ✅

**Default wait time:** 10 seconds
**Configurable:** 0-60 seconds via `responseWaitTime` parameter

**Current Limitation:** Audio transmission works, but reception has port binding issues being debugged.

## Skill Standard Compliance

Both skills follow the [Agent Skills](https://agentskills.io) open standard:

### Frontmatter Structure

```yaml
---
name: skill-name                    # Lowercase, hyphens only (max 64 chars)
description: What this skill does   # Used by AI to decide when to invoke
argument-hint: [optional-args]      # Shown during autocomplete
allowed-tools: Bash(node *), Read   # Tools allowed without permission
user-invocable: true/false          # Show in / menu
disable-model-invocation: true/false # Prevent auto-invocation
---
```

### Content Structure

1. **Overview** - What the skill teaches
2. **Installation** - How to set up
3. **Usage** - How to use
4. **Examples** - Common workflows
5. **Troubleshooting** - Common issues
6. **Best Practices** - Do's and don'ts

## Skill Discovery Tiers

Skills are discovered in priority order:

```
1. Enterprise (managed settings)
   ↓
2. Personal (~/.claude/skills/)
   ↓
3. Project (.claude/skills/)
   ↓
4. Plugin (<plugin>/skills/)
```

## Cross-Platform Compatibility

### Claude Code
- **Primary:** `~/.claude/skills/`
- **Project:** `.claude/skills/`
- **Docs:** https://code.claude.com/docs/en/skills

### Gemini CLI
- **Symlinked:** `~/.config/gemini/skills/`
- **Docs:** https://geminicli.com/docs/cli/skills/

### OpenAI Codex
- **Symlinked:** `~/.config/openai/skills/`
- **Docs:** https://developers.openai.com/codex/skills/

### Aider
- **Symlinked:** `~/.aider/skills/`

## How AI Assistants Use These Skills

### Personal Skill (`pinmoli`)

**Auto-Invocation:**
When user says:
- "Test sip:example.com with OPTIONS"
- "Generate speech saying hello world"
- "Call the agent and wait 20 seconds for response"
- "How do I test a SIP endpoint?"
- "Debug this VoIP connection"
- "Make a test call to LiveKit"

**Manual Invocation:**
```
/pinmoli sip:example.com OPTIONS
```

**What AI Learns:**
- How to install and run Pinmoli
- The 5 hardcoded skills (sip_test, analyze_failure, save_test, load_test, list_tests)
- Common workflows (test endpoint, make call, debug failure, save config)
- Troubleshooting (agent not calling tools, socket errors, timeouts)
- Best practices (when to use, good test requests, naming conventions)
- Architecture (TUI → Agent → Skills → SIP → Storage)
- LiveKit integration details

### Project Skill (`pinmoli-dev`)

**Auto-Invocation:**
Automatically loaded when working in the project root directory

**Manual Invocation:**
Not user-invocable (background context only)

**What AI Learns:**
- Architecture patterns (async generators, Zod validation, errors as data)
- Code conventions (5 skills only, domain restrictions, socket cleanup)
- Testing philosophy (49 tests, real LiveKit, no mocks)
- Common mistakes to avoid (from AGENTS.md)
- Development workflows (adding codecs, fixing bugs, adding features)
- File structure and dependencies
- Performance characteristics

## Key Features

### 1. String Substitutions

Skills support dynamic values:

```markdown
Test $ARGUMENTS with OPTIONS
# User: /pinmoli sip:example.com
# AI sees: Test sip:example.com with OPTIONS

Migrate $0 from $1 to $2
# User: /migrate SearchBar React Vue
# AI sees: Migrate SearchBar from React to Vue
```

### 2. Dynamic Context Injection

Skills can run shell commands before AI sees content:

```markdown
PR diff: !`gh pr diff`
# Command runs first, output inserted
# AI sees actual diff, not the command
```

### 3. Tool Restrictions

Skills can limit which tools AI can use:

```yaml
allowed-tools: Bash(node *), Read, Write
# AI can use these without asking permission
```

### 4. Invocation Control

```yaml
# Only you can invoke
disable-model-invocation: true

# Only AI can invoke (background context)
user-invocable: false
```

## Testing Skills

### With Claude Code

```bash
# Start Claude Code
claude

# Check if skill is loaded
What skills are available?

# Invoke manually
/pinmoli sip:example.com OPTIONS

# Let Claude invoke automatically
Test sip:example.com with OPTIONS
```

### With Gemini CLI

```bash
gemini --skills
gemini "Test sip:example.com with OPTIONS"
```

## Skill Content Summary

### Personal Skill Teaches:

1. **Installation**
   - npm install, build, run
   - Configuration (~/.pinmoli/config.json)
   - Environment variables (ANTHROPIC_API_KEY)

2. **The 5 Skills**
   - sip_test: Execute SIP tests
   - analyze_failure: Analyze failures
   - save_test: Save configurations
   - load_test: Load configurations
   - list_tests: List all tests

3. **Common Workflows**
   - Test endpoint: `test sip:example.com with OPTIONS`
   - Make call: `make an INVITE call using opus codec`
   - Debug failure: `analyze the failure`
   - Save config: `save this test as "name"`

4. **Architecture**
   - TUI → Agent → Skills → SIP → Storage
   - Event streaming (circular buffer, max 1000)
   - Real-time updates

5. **Troubleshooting**
   - Agent not calling tools
   - Socket errors
   - Test timeouts
   - Tests not found

6. **Best Practices**
   - When to use Pinmoli
   - Writing good test requests
   - Naming saved tests

### Project Skill Teaches:

1. **Architecture Patterns**
   - Async generators for streaming
   - Zod as single source of truth
   - Validation at every boundary
   - Errors as data (no exceptions)
   - Socket cleanup guards

2. **Critical Rules**
   - Test through TUI (never bypass)
   - Update tests atomically
   - Start minimal (YAGNI)
   - Use Zod for validation
   - Guard resource cleanup
   - 5 skills only (no dynamic registration)

3. **File Structure**
   - src/ organization
   - test/ structure
   - Documentation files

4. **Testing**
   - 49 tests (32 unit, 17 integration)
   - Real LiveKit endpoints
   - No mocks for network testing

5. **Common Tasks**
   - Adding new codec
   - Fixing bugs
   - Adding features

6. **Known Issues**
   - Agent not calling LLM
   - Socket cleanup errors
   - Test timeouts

## Benefits

### For Users

1. **Natural Language Testing**
   - Just describe what you want to test
   - AI figures out the right parameters
   - No need to remember command syntax

2. **Cross-Platform**
   - Works with Claude Code, Gemini CLI, OpenAI Codex, Aider
   - Same skill, multiple tools

3. **Context-Aware**
   - AI knows when to use Pinmoli
   - Suggests relevant workflows
   - Provides troubleshooting help

### For Developers

1. **Automatic Context**
   - Project skill loads automatically
   - No need to explain architecture
   - AI knows code patterns

2. **Mistake Prevention**
   - AI learns from AGENTS.md mistakes
   - Follows best practices
   - Avoids known pitfalls

3. **Consistent Workflows**
   - AI follows established patterns
   - Tests are updated atomically
   - Code style is consistent

## Maintenance

### Updating Skills

Skills support live reloading:

```bash
# Edit skill
vim ~/.claude/skills/pinmoli/SKILL.md

# Changes picked up automatically
# No restart needed
```

### Adding New Skills

```bash
# Personal skill (all projects)
mkdir -p ~/.claude/skills/new-skill
cat > ~/.claude/skills/new-skill/SKILL.md << 'EOF'
---
name: new-skill
description: What it does
---
Instructions...
EOF

# Project skill (this project only)
mkdir -p .claude/skills/new-skill
cat > .claude/skills/new-skill/SKILL.md << 'EOF'
---
name: new-skill
description: What it does
---
Instructions...
EOF
```

## Verification

```bash
# Check personal skill
ls -la ~/.claude/skills/pinmoli/
# Should show: SKILL.md, README.md

# Check symlinks
ls -la ~/.config/gemini/skills/
ls -la ~/.config/openai/skills/
ls -la ~/.aider/skills/
# Should show: pinmoli -> ~/.claude/skills/pinmoli

# Check project skill
ls -la .claude/skills/pinmoli-dev/
# Should show: SKILL.md
```

## Resources

- **Agent Skills Standard:** https://agentskills.io
- **Claude Code Docs:** https://code.claude.com/docs/en/skills
- **Gemini CLI Docs:** https://geminicli.com/docs/cli/skills/
- **OpenAI Codex Docs:** https://developers.openai.com/codex/skills/

## Summary

Created comprehensive skills following the Agent Skills open standard:

1. ✅ **Personal skill** teaching AI how to use Pinmoli
2. ✅ **Project skill** providing development context
3. ✅ **Cross-platform symlinks** for Gemini, OpenAI, Aider
4. ✅ **Complete documentation** in README
5. ✅ **Standard compliance** with proper frontmatter
6. ✅ **Live reloading** support
7. ✅ **Auto-invocation** based on descriptions
8. ✅ **Manual invocation** with `/skill-name`

AI assistants can now understand and use Pinmoli across multiple platforms!
