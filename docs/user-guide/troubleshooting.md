# Troubleshooting

Common issues and their solutions when using Coding Harness.

## Installation Issues

### `command not found: coding-harness`
**Cause:** npm global bin directory not in PATH.  
**Fix:** Add npm global bin to PATH or use npx:
```bash
npx coding-harness --version
```

### `EACCES: permission denied`
**Cause:** Insufficient permissions for npm global install.  
**Fix:** Use a Node version manager (nvm, fnm, volta):
```bash
volta install node
npm install -g coding-harness
```

## Initialization Issues

### `init: directory not empty`
**Cause:** Trying to initialize in a non-empty directory.  
**Fix:** Use `--force` to overwrite, or initialize in an empty directory:
```bash
coding-harness init --force
```

### `doctor: missing required files`
**Cause:** Some harness files are missing after init.  
**Fix:** Re-run init or create missing files manually:
```bash
coding-harness init --repair
```

## Migration Issues

### `migrate: incompatible schema`
**Cause:** Settings schema cannot be migrated automatically.  
**Fix:** Run validation to see specific issues:
```bash
coding-harness migrate --validate
```

### `rollback: no backups found`
**Cause:** No backup files exist in the project directory.  
**Fix:** Check for backups in `.backup-*.json` files:
```bash
ls .backup-*.json
```

## Debug Mode

Enable debug logging to diagnose issues:

```bash
# Set debug level
export CODING_HARNESS_DEBUG=1

# Run with verbose output
coding-harness --verbose doctor
```

## Log Files

Logs are stored in:
- **Linux/macOS:** `~/.coding-harness/logs/`
- **Windows:** `%USERPROFILE%\.coding-harness\logs\`

```bash
# View recent logs
coding-harness logs --tail 50
```

## Reporting Bugs

1. Check [existing issues](https://github.com/coding-harness/issues)
2. Run `coding-harness doctor --report` to gather diagnostics
3. Include in your report:
   - Node version (`node --version`)
   - Coding Harness version (`coding-harness --version`)
   - OS and version
   - Steps to reproduce
   - Error output with `--verbose`

## Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `EINIT` | Initialization failure | Check directory permissions |
| `EMIGRATE` | Migration failure | Check schema compatibility |
| `EVALIDATE` | Validation failure | Run doctor for details |
| `EHOOK` | Hook execution failure | Check hook script permissions |
| `ESKILL` | Skill loading failure | Validate SKILL.md format |
