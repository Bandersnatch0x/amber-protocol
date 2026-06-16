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
- `node scripts/amber.js route list` — list available routes.
- `node scripts/amber.js session status` — inspect the current session.
- `node scripts/amber.js adoption report --target <repo> --output-dir docs/examples/adoptions` — generate an adoption report.
- `node scripts/amber.js plan --target <repo> --feature <feature-id> --title "<title>"` — scaffold a feature plan.

## Safety boundaries

- Read-only / dry-run first; `init` and `wiki` never overwrite existing files.
- Amber does not auto-execute target-project commands, dispatch live agents, or run dynamic workflows.
- Never overwrite user-authored files without explicit approval.

## Skills & commands

`skills/<name>/SKILL.md` is the single source of truth. Run `npm run gen:agents` to
regenerate every platform product (edit `skills/`, never the generated files;
`npm run gen:agents:check` guards against drift in CI):

- **Claude Code** — loaded via `.claude-plugin/` → `skills/`; manual slash commands in `.claude/commands/`.
- **Codex & Cursor** — skills mirrored to `.agents/skills/` (the shared open-standard location both read natively).
- **Gemini CLI** — manual commands in `.gemini/commands/amber/`.
