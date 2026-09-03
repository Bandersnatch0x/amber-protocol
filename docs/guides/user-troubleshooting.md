# Troubleshooting

Common issues and their solutions when using Amber Protocol.

## Installation Issues

### `command not found: amber-protocol`
**Cause:** npm global bin directory not in PATH.  
**Fix:** Add npm global bin to PATH or use npx:
```bash
npx amber-protocol --version
```

### `EACCES: permission denied`
**Cause:** Insufficient permissions for npm global install.  
**Fix:** Use a Node version manager (nvm, fnm, volta):
```bash
volta install node
npm install -g amber-protocol
```

## Initialization Issues

### `init: directory not empty`
**Cause:** Trying to initialize in a non-empty directory.  
**Fix:** Use `--force` to overwrite, or initialize in an empty directory:
```bash
amber-protocol init --force
```

### `doctor: missing required files`
**Cause:** Some Amber files are missing after init.  
**Fix:** Re-run init or create missing files manually:
```bash
amber-protocol init --repair
```

## Migration Issues

### `migrate: incompatible schema`
**Cause:** Settings schema cannot be migrated automatically.  
**Fix:** Run validation to see specific issues:
```bash
amber-protocol migrate --validate
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
export AMBER_DEBUG=1

# Run with verbose output
amber-protocol --verbose doctor
```

## Log Files

Logs are stored in:
- **Linux/macOS:** `~/.amber-protocol/logs/`
- **Windows:** `%USERPROFILE%\.amber-protocol\logs\`

```bash
# View recent logs
amber-protocol logs --tail 50
```

## Reporting Bugs

1. Check existing issues in the project issue tracker
2. Run `amber-protocol doctor --report` to gather diagnostics
3. Include in your report:
   - Node version (`node --version`)
   - Amber Protocol version (`amber-protocol --version`)
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
