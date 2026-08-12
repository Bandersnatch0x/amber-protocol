---
module: amber-protocol
role: governance-layer
entry_point: scripts/amber.js
boundary: repository-local
scope: root
safety:
  - read-only-first
  - never-overwrite-user-files
  - executesAnything: false
---

# AGENTS.md

Amber Protocol is a repository-local governance layer for agent-assisted engineering.
All capability is exposed through one CLI entry point.

Operating manual: `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` — boundaries, gates, evidence, and routing rules; read before nontrivial tasks.

## Entry point

```bash
node scripts/amber.js <command> --target <repo>
```

## Core commands

Default `amber` help projects the journey entry (`next`) and core governance commands below.
Use `node scripts/amber.js --all` for deprecated and expert compatibility commands.

- `node scripts/amber.js init --target <repo>` - install the V1 scaffold (skips existing files).
- `node scripts/amber.js audit --target <repo>` - read-only readiness inspection.
- `node scripts/amber.js wiki --target <repo>` - create/validate the wiki skeleton.
- `node scripts/amber.js doctor --target <repo>` - validate the Amber setup.
- `node scripts/amber.js handoff --target <repo>` - validate session handoff state.
- `node scripts/amber.js governance report --target <repo>` - score readiness, risks, and structured next actions.
- `node scripts/amber.js handoff bundle --target <repo>` - produce the portable continuation bundle.
- `node scripts/amber.js handoff validate --target <repo>` - verify the handoff bundle is complete.
- `node scripts/amber.js context request --target <repo> --page <id>` - write a distillation contract; `ingest`/`verify`/`refresh`/`stats` close the loop (ADR-0009).
- `node scripts/amber.js route list` - list available routes.
- `node scripts/amber.js session status` - inspect the current session.
- Deprecated adoption reports remain available via `node scripts/amber.js --all` and `amber adoption --help`; prefer the diagnosis/adoption journey for new work.
- `node scripts/amber.js plan --target <repo> --feature <feature-id> --title "<title>"` - scaffold a feature plan.
- `node scripts/amber.js loop recommend` / `loop run --dry-run` — safe continuous improvement entrypoints (see LOOP.md).
- `node scripts/amber.js next --objective "<goal>" --target <repo>` - deterministic route advice; never an LLM decision.

## Safety boundaries

- Read-only / dry-run first; `init` and `wiki` never overwrite existing files.
- Amber does not auto-execute target-project commands, dispatch live agents, or run dynamic workflows.
- Never overwrite user-authored files without explicit approval.

## Governance philosophy (operational-ontology positioning)

Amber is positioned as an operational-ontology governance layer: agents act
_through_ Amber's governed surface, not around it. The protocol exposes
verbs (Action Types, `schemas/action.type.schema.json`) on top of the
objects it already manages (sessions, routes, wiki, evidence). Design
reference: `docs/wiki/amber-ontology-mcp.md` — the P1 stdio MCP server
(`scripts/amber-mcp.js`) and P2 OAG query layer (`amber.object.query`)
are implemented. F018 enforces the governance seam: only registry-proven
read-only variants execute without approval; every mutating operation is
returned as approval-required and is never spawned by the adapter; corrupt
governance state and non-zero command results fail closed (`isError`); and
every Action/Function is confined to repositories configured at startup
(`scripts/lib/mcp-targets.js`, `scripts/lib/mcp-action-contracts.js`).

See also `LOOP.md` (loop engineering self-description) and the explicit `execution: { executesAnything: false }` rule in all Amber loop contracts.

## Skills & commands

`skills/<name>/SKILL.md` is the single source of truth. Run `npm run gen:agents` to
regenerate every platform product (edit `skills/`, never the generated files;
`npm run gen:agents:check` guards against drift in CI).

This repo also follows loop-engineering patterns (see LOOP.md). Skills in `skills/` can be used directly from Grok `/loop`, Claude `$skill`, etc. The `amber-continuous-improvement` skill implements a governed form of daily triage.

Use the user-invoked `amber` router to choose among four deep journeys: `amber-delivery`,
`amber-diagnosis-adoption`, `amber-context-continuity`, and `amber-continuous-improvement`.
The journey skills compose deterministic CLI primitives; they do not add execution authority.

- **Claude Code** - loaded via `.claude-plugin/` -> `skills/`; manual slash commands in `.claude/commands/`.
- **Codex & Cursor** - skills mirrored to `.agents/skills/` (the shared open-standard location both read natively).
- **Gemini CLI** - manual commands in `.gemini/commands/amber/`.
