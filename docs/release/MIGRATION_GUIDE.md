# Migration Guide: V5.5 → Phase B v1.0.0

This guide walks you through migrating your Coding Harness project from V5.5 to Phase B.

## Prerequisites

- [ ] Node.js >= 18.17 installed
- [ ] V5.5 project with valid `settings.json`
- [ ] **Backup your project** (`git commit` or manual copy)
- [ ] Read the [Release Notes](./RELEASE_NOTES.md) for breaking changes

## Step-by-Step Migration

### Step 1: Check Current Version

```bash
coding-harness --version
# Should show: coding-harness v5.5
```

### Step 2: Dry-Run Migration

See exactly what will change before applying:

```bash
coding-harness migrate --dry-run
```

**Expected output:**
```
Migration Preview
=================
+ version: "5.5" → "1.0.0"
+ framework: (none) → "phase-b"
+ skills: (none) → []
+ profiles: (none) → {}
- deprecated_field: (removed)
- legacy_api: (removed)

Summary: 4 fields added, 2 fields removed.
```

### Step 3: Apply Migration

```bash
coding-harness migrate
```

A backup is automatically created at `.backup-YYYY-MM-DD-HHmmss.json`.

### Step 4: Verify Migration

```bash
coding-harness validate
coding-harness doctor
```

### Step 5: Review Changes

Check your updated `settings.json`:

```json
{
  "version": "1.0.0",
  "framework": "phase-b",
  "migrationId": "uuid-here",
  "migratedAt": "2026-06-10T12:00:00.000Z",
  "agents": { /* preserved */ },
  "routes": [ /* preserved */ ],
  "skills": [],
  "profiles": {}
}
```

### Step 6: Test Functionality

```bash
# Test existing routes
coding-harness route test default --dry-run

# Verify skills load
coding-harness skill list

# Run security audit
coding-harness security audit
```

## Field Mapping Reference

| V5.5 Field | Phase B Field | Notes |
|------------|---------------|-------|
| `version: "5.5"` | `version: "1.0.0"` | Updated |
| _(none)_ | `framework: "phase-b"` | New required |
| `agents` | `agents` | Preserved, defaults added |
| `routes` | `routes` | Migrated automatically |
| _(none)_ | `skills: []` | New required |
| _(none)_ | `profiles: {}` | New required |
| `deprecated_field` | _(removed)_ | No longer supported |
| `legacy_api` | _(removed)_ | Migrate to skills |
| `old_config` | _(removed)_ | Migrate to profiles |
| `legacyMode` | _(removed)_ | Unified under Phase B |
| `compat` | _(removed)_ | Use explicit migration |

## Common Migration Issues

### "migrate: incompatible schema"
**Fix:** Run `coding-harness migrate --validate` to see specific incompatibilities.

### "doctor: missing skills" after migration
**Fix:** Phase B expects a `skills` array. Add `"skills": []` if you have no skills yet.

### "route test: framework mismatch"
**Fix:** Routes are automatically updated with `framework: "phase-b"`. If you see this, re-run migration.

## Rollback Procedure

If you need to revert to V5.5:

```bash
# List available backups
coding-harness rollback --list

# Restore from a specific backup
coding-harness rollback --restore .backup-2026-06-10-120000.json

# Verify rollback
coding-harness --version
# Should show: coding-harness v5.5
```

## Validation Checklist

After migration, verify:
- [ ] `coding-harness --version` shows `v1.0.0`
- [ ] `coding-harness validate` passes
- [ ] `coding-harness doctor` shows no errors
- [ ] `coding-harness route list` shows your routes
- [ ] `coding-harness security audit` runs successfully

## Need Help?

- [Troubleshooting Guide](../user-guide/troubleshooting.md)
- [FAQ](../user-guide/faq.md)
- [GitHub Issues](https://github.com/coding-harness/issues)
