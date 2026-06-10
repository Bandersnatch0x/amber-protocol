# Data Flow

How data moves through the Coding Harness Phase B system.

## Tool Invocation Flow

```
User Input
    │
    ▼
┌──────────────┐
│ Route Engine │ ◄── Selects matching route based on goals
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ PreToolUse   │ ◄── Hook: Validate & filter tool calls
│   Hook       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Execute    │ ◄── Run the tool or action
│   Tool       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ PostToolUse  │ ◄── Hook: Audit & transform output
│   Hook       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Stage Result │ ◄── Record in timeline / checkpoint
└──────┬───────┘
       │
       ▼
   Next Stage / Output
```

## Skill Discovery and Loading

```
Startup
    │
    ▼
┌──────────────────┐
│ Read settings.json│
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Enumerate skills │ ◄── Scan `skills/` directory
│   directories    │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Parse SKILL.md   │ ◄── Extract name, triggers, instructions
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Validate skills  │ ◄── Check structure and completeness
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Register in      │ ◄── Add to skill registry
│   Registry       │
└──────────────────┘
```

## Agent Orchestration Pattern

```
┌─────────────────────────────────────────┐
│              Orchestrator                 │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐│
│  │ Worker  │  │ Worker  │  │ Reviewer ││
│  │ Agent   │  │ Agent   │  │ Agent    ││
│  └────┬────┘  └────┬────┘  └────┬─────┘│
│       │            │            │       │
│       ▼            ▼            ▼       │
│  ┌─────────────────────────────────┐   │
│  │     Shared Session Context      │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## State Management

### Session States

```
created → running → completed
                  → aborted
                  → failed
```

### Checkpoint States

```
checkpoint-0 → checkpoint-1 → ... → checkpoint-N
     │                                │
     ▼                                ▼
  save state                     restore state
```

## Persistence

| Data | Location | Format |
|------|----------|--------|
| Settings | `settings.json` | JSON |
| Sessions | `~/.coding-harness/sessions/` | JSON manifest + timeline |
| Backups | `.backup-*.json` | JSON |
| Logs | `~/.coding-harness/logs/` | Text/JSON |
| Reports | `docs/reports/` | Markdown |

## Integration Points

```
Coding Harness
    │
    ├── Git (hooks)
    ├── npm (audit)
    ├── MCP Servers (tools)
    ├── LLM Providers (agents)
    └── File System (persistence)
```

---

See also: [Architecture Overview](./overview.md), [Extension Points](./extension-points.md)
