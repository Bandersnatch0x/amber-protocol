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

## Security Commands

### `security audit`

Run full security audit.

```bash
amber-protocol security audit [--target <dir>] [--output <file>]
```

### `security scan dependencies`

Scan npm dependencies for vulnerabilities.

```bash
amber-protocol security scan dependencies [--severity <level>]
```

### `security scan secrets`

Scan source code for hardcoded secrets.

```bash
amber-protocol security scan secrets [--path <dir>]
```

### `security review permissions`

Review permission configuration.

```bash
amber-protocol security review permissions [--target <dir>]
```

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

---

See also: [Hooks API](./hooks-api.md), [Skill API](./skill-api.md)
