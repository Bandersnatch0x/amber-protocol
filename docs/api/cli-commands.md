# CLI Commands Reference

Complete reference for Coding Harness CLI commands (Phase B v1.0.0).

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

Initialize a new Coding Harness project.

```bash
coding-harness init [--target <dir>] [--force] [--dry-run]
```

| Option | Description |
|--------|-------------|
| `--target <dir>` | Target directory (default: current) |
| `--force` | Overwrite existing files |
| `--dry-run` | Show what would be created |

### `doctor`

Diagnose project health and configuration.

```bash
coding-harness doctor [--target <dir>] [--report]
```

| Option | Description |
|--------|-------------|
| `--target <dir>` | Target directory to diagnose |
| `--report` | Generate detailed report file |

## Migration Commands

### `migrate`

Migrate settings from V5.5 to Phase B.

```bash
coding-harness migrate [--dry-run] [--validate] [--target <dir>]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview migration without applying |
| `--validate` | Only validate, no migration |
| `--target <dir>` | Target settings directory |

### `rollback`

Roll back to a previous backup.

```bash
coding-harness rollback [--list] [--restore <file>] [--dry-run]
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
coding-harness route list
```

### `route inspect`

Show details for a specific route.

```bash
coding-harness route inspect <name> [--json]
```

### `route test`

Test a route (dry-run).

```bash
coding-harness route test <name> [--dry-run] [--stage <n>]
```

### `route validate`

Validate a route definition.

```bash
coding-harness route validate <file>
```

## Session Commands

### `session start`

Start a new execution session.

```bash
coding-harness session start [--route <name>] [--agent <name>] [--goal "<text>"]
```

### `session status`

Show status of current or specified session.

```bash
coding-harness session status [<id>]
```

### `session list`

List all sessions.

```bash
coding-harness session list [--limit <n>]
```

### `session abort`

Abort an active session.

```bash
coding-harness session abort [<id>]
```

## Security Commands

### `security audit`

Run full security audit.

```bash
coding-harness security audit [--target <dir>] [--output <file>]
```

### `security scan dependencies`

Scan npm dependencies for vulnerabilities.

```bash
coding-harness security scan dependencies [--severity <level>]
```

### `security scan secrets`

Scan source code for hardcoded secrets.

```bash
coding-harness security scan secrets [--path <dir>]
```

### `security review permissions`

Review permission configuration.

```bash
coding-harness security review permissions [--target <dir>]
```

## Skill Commands

### `skill list`

List registered skills.

```bash
coding-harness skill list
```

### `skill validate`

Validate a skill definition.

```bash
coding-harness skill validate <name>
```

### `skill test`

Test a skill with input.

```bash
coding-harness skill test <name> --input "<text>"
```

## Adoption Commands

### `adoption report`

Generate adoption report.

```bash
coding-harness adoption report --target <dir> [--output <file>] [--output-dir <dir>]
```

### `adoption gate`

Check adoption gate status.

```bash
coding-harness adoption gate --target <dir> [--output <file>]
```

---

See also: [Hooks API](./hooks-api.md), [Skill API](./skill-api.md)
