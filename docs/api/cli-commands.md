# CLI Commands Reference

Complete reference for Amber Protocol CLI commands (Phase B v1.0.0).

## Global Flags

| Flag | Description |
|------|-------------|
| `--version` | Show version number |
| `--help` | Show help for any command |
| `--verbose` | Enable verbose output |
| `--json` | Output in JSON format |
| `--dry-run` | Preview changes without executing |

## Service packages

The commands below are organized into service packages. Service packages are documentation and navigation groupings over existing CLI commands; they are not new CLI command namespaces.

| Service package | Existing commands |
| --- | --- |
| Repository Onboarding | [`init`](#init), [`doctor`](#doctor), `wiki` |
| Adoption Review | [`adoption report`](#adoption-report), `adoption bundle`, [`adoption gate`](#adoption-gate) |
| Governed Delivery | [`plan`](#plan), [`gate`](#gate), [`review`](#review), [`accept`](#accept), [`session complete-check`](#session-complete-check) |
| Continuity Layer | [`session start`](#session-start), [`session status`](#session-status), `session continue` |
| Security Governance | [`security audit`](#security-audit), security governance packs |

## Core Commands

### `init`

Initialize a new Amber Protocol project.

```bash
amber-protocol init [--target <dir>] [--force] [--dry-run]
```

| Option | Description |
|--------|-------------|
| `--target <dir>` | Target directory (default: current) |
| `--force` | Overwrite existing files |
| `--dry-run` | Show what would be created |

### `doctor`

Diagnose project health and configuration.

```bash
amber-protocol doctor [--target <dir>] [--report]
```

| Option | Description |
|--------|-------------|
| `--target <dir>` | Target directory to diagnose |
| `--report` | Generate detailed report file |

## Planning and Review Commands

### `plan`

Create a feature-linked vertical-slice plan without overwriting existing files.

```bash
amber-protocol plan --target <dir> --feature <id> --title "<title>" [--dry-run]
```

Generated plans include Goal, High Level Design, Vertical Slices, Resume Checkpoint, Acceptance Criteria, Verification, and Evidence Schema sections. The Resume Checkpoint records the continuation state for future sessions and must define `Resume Point`, `Blockers`, `Next Action`, and `Recovery Instructions` fields.

### `gate`

Validate that a plan is tied to feature state, includes the required plan sections, has complete Resume Checkpoint fields, and has user confirmation.

```bash
amber-protocol gate --target <dir> --plan <relative-path>
```

### `review`

Review a plan against static standards and release-readiness checks.

```bash
amber-protocol review --target <dir> --plan <relative-path>
```

### `accept`

Accept a reviewed plan and append an evolution record. When `--session` is provided, also prints the session's completion-check status as a warning; with `--strict`, missing evidence becomes an error.

```bash
amber-protocol accept --target <dir> --plan <relative-path> [--session <id>] [--strict]
```

| Option | Description |
|--------|-------------|
| `--plan <path>` | Relative path to the plan to accept |
| `--session <id>` | Optional session id for completion-check |
| `--strict` | Turn missing completion evidence into errors |

## Migration Commands

### `migrate`

Migrate settings from V5.5 to Phase B.

```bash
amber-protocol migrate [--dry-run] [--validate] [--target <dir>]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview migration without applying |
| `--validate` | Only validate, no migration |
| `--target <dir>` | Target settings directory |

### `rollback`

Roll back to a previous backup.

```bash
amber-protocol rollback [--list] [--restore <file>] [--dry-run]
```

| Option | Description |
|--------|-------------|
| `--list` | List available backups |
| `--restore <file>` | Restore from specific backup |
| `--dry-run` | Show what would be restored |

## Route Commands

### `route list`

List available routes.

```bash
amber-protocol route list
```

### `route inspect`

Show details for a specific route.

```bash
amber-protocol route inspect <name> [--json]
```

### `route test`

Test a route (dry-run).

```bash
amber-protocol route test <name> [--dry-run] [--stage <n>]
```

### `route validate`

Validate a route definition.

```bash
amber-protocol route validate <file>
```

## Session Commands

### `session start`

Start a new execution session.

```bash
amber-protocol session start [--route <name>] [--agent <name>] [--goal "<text>"]
```

### `session status`

Show status of current or specified session.

```bash
amber-protocol session status [<id>]
```

### `session list`

List all sessions.

```bash
amber-protocol session list [--limit <n>]
```

### `session abort`

Abort an active session.

```bash
amber-protocol session abort [<id>]
```

### `session complete-check`

Report whether a session has enough goal, timeline, verification, approval, and handoff evidence to be treated as complete. Report-only unless `--strict` is passed.

```bash
amber-protocol session complete-check --session <id> [--strict]
```

## Security Commands

### `security audit`

Generate a security governance audit report in report-only mode. The current CLI wrapper produces a report from the security report generator without executing real dependency or filesystem scans, and it does not mutate target code.

```bash
amber-protocol security audit [--target <dir>] [--output <file>]
```

| Option | Description |
|--------|-------------|
| `--target <dir>` | Target directory (default: current) |
| `--output <file>` | Write the report to a file instead of stdout |

## Skill Commands

### `skill list`

List registered skills.

```bash
amber-protocol skill list
```

### `skill validate`

Validate a skill definition.

```bash
amber-protocol skill validate <name>
```

### `skill test`

Test a skill with input.

```bash
amber-protocol skill test <name> --input "<text>"
```

## Adoption Commands
> ⚠️ **DEPRECATED** — will be removed in v2. Use `amber governance audit` instead.

### `adoption report`

Generate adoption report.

```bash
amber-protocol adoption report --target <dir> [--output <file>] [--output-dir <dir>]
```

### `adoption gate`

Check adoption gate status.

```bash
amber-protocol adoption gate --target <dir> [--output <file>]
```

## Maintenance Commands

### `maintenance distill`

Find repeated work patterns across plans, reviews, gate reports, adoption next-actions, and maintenance proposals, and write a reviewable markdown candidate list. Does not install or execute workflow packs.

```bash
amber-protocol maintenance distill --target <dir> [--output <file>]
```

| Option | Description |
|--------|-------------|
| `--target <dir>` | Target directory (default: current) |
| `--output <file>` | Output path for the proposal (default: `docs/maintenance/distill-proposals.md`) |

---

See also: [Hooks API](./hooks-api.md), [Skill API](./skill-api.md)
