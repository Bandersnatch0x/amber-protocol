# Migrating from V5.5

This tutorial walks through migrating an existing Coding Harness V5.5 project to Phase B.

## Prerequisites

- V5.5 project with `settings.json`
- Backup of your current project
- Node.js >= 18.17

## Step 1: Check Current Version

```bash
coding-harness version
# => Current version: 5.5
```

## Step 2: Dry-Run Migration

```bash
# Preview changes without applying
coding-harness migrate --dry-run
```

Review the output carefully. The dry-run shows:
- Fields that will be added
- Fields that will be removed or renamed
- Required changes

## Step 3: Create Backup

```bash
# Manual backup (also done automatically)
cp settings.json settings.v55.backup.json
```

## Step 4: Run Migration

```bash
coding-harness migrate
```

This creates:
- Updated `settings.json` with Phase B format
- Auto-backup at `.backup-YYYY-MM-DD-HHmmss.json`

## Step 5: Validate Migration

```bash
coding-harness validate
coding-harness doctor
```

## Step 6: Test Functionality

```bash
# Run existing routes
coding-harness route test default --dry-run

# Verify skills load
coding-harness skill list
```

## Key Changes

| V5.5 Field | Phase B Field | Notes |
|------------|---------------|-------|
| `version: "5.5"` | `version: "1.0.0"` | Version bumped |
| _(none)_ | `framework: "phase-b"` | New required field |
| `agents` | `agents` | Preserved with defaults |
| `routes` | `routes` | Migrated automatically |
| _(none)_ | `skills: []` | New required field |
| `deprecated_field` | _(removed)_ | No longer supported |

## Rollback

If you need to revert:

```bash
# List available backups
coding-harness rollback --list

# Restore from backup
coding-harness rollback --restore .backup-2026-06-01-120000.json
```

---

See also: [Migration Guide](../../release/MIGRATION_GUIDE.md)
