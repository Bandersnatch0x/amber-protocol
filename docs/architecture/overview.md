# System Architecture

High-level overview of the Coding Harness Phase B architecture.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Interface                         │
│  init · doctor · migrate · route · session · security       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                     Route Engine                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Route Loader│  │Route Selector│  │  Stage Executor     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    Core Subsystems                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  Hooks   │  │  Skills  │  │  Agents  │  │  Sessions  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  Infrastructure                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Migration│  │ Security │  │Validation│  │ Rollback    │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Core Subsystems

### Hooks System (`hooks/`)

Lifecycle hooks that intercept tool execution, git operations, and session events.

- **PreToolUse**: Validates and filters tool calls before execution
- **PostToolUse**: Audits and transforms tool output
- **PreCommit/PrePush**: Git lifecycle hooks for quality gates
- **Custom Hooks**: User-defined JavaScript hooks via `settings.json`

### Skills System (`skills/`)

Extensible skill plugins that add capabilities to agents.

- **SKILL.md format**: Markdown-based skill definitions
- **Programmatic API**: JavaScript skill modules for complex logic
- **Template system**: Quick-start templates for common skill types
- **Registry**: Central registry for skill discovery and validation

### Agent System (`agents/`)

Configurable AI agent profiles with model selection, tool permissions, and skill sets.

- **Profiles**: Named configurations (`profiles/*.profile.json`)
- **Multi-agent**: Worker/reviewer pattern support
- **Budget control**: Token and thinking budget management
- **Tool permissions**: Fine-grained allow/block lists

### Session System (`sessions/`)

Execution session management with state tracking and checkpointing.

- **State machine**: created → running → completed/aborted/failed
- **Timeline**: Event-based execution log
- **Checkpoints**: Save/restore session progress
- **Manifest**: Session metadata and configuration

## Design Principles

1. **Least Privilege**: Tools and permissions are explicitly granted
2. **Idempotency**: Operations can be safely repeated
3. **Observability**: All actions are logged and auditable
4. **Extensibility**: Skills, hooks, and routes are pluggable
5. **Safe by Default**: Dry-run modes prevent accidental changes

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js >= 18.17 |
| Language | JavaScript (CommonJS) |
| Package Manager | npm |
| Validation | AJV (JSON Schema) |
| Testing | Node.js built-in test runner |
| Linting | ESLint, Prettier |

---

See also: [Data Flow](./data-flow.md), [Extension Points](./extension-points.md)
