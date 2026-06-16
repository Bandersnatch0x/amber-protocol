# AGENTS.md

Amber Protocol is a repository-local governance layer for agent-assisted engineering.
All capability is exposed through one CLI entry point.

## Entry point

```bash
node scripts/amber.js <command> --target <repo>
```

## Core commands

- `node scripts/amber.js init --target <repo>` — install the V1 scaffold (skips existing files).
- `node scripts/amber.js audit --target <repo>` — read-only readiness inspection.
- `node scripts/amber.js wiki --target <repo>` — create/validate the wiki skeleton.
- `node scripts/amber.js doctor --target <repo>` — validate the Amber setup.
- `node scripts/amber.js handoff --target <repo>` — validate session handoff state.

## Safety boundaries

- Read-only / dry-run first; `init` and `wiki` never overwrite existing files.
- Amber does not auto-execute target-project commands, dispatch live agents, or run dynamic workflows.
- Never overwrite user-authored files without explicit approval.

## Skills & commands

Per-command agent instructions live in `skills/<name>/SKILL.md` (the source of truth).
Run `npm run gen:agents` to regenerate Claude (`.claude/commands/`) and Gemini
(`.gemini/commands/amber/`) command products; edit `skills/`, never the generated files.
