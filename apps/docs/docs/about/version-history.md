---
id: version-history
title: "Version History & Migration Notes"
sidebar_label: "Version History"
description: "Curated version history, breaking changes, support matrix, and notes on retired legacy commands."
---

# Version History & Migration Notes

This page provides the canonical version identity, environment support matrix, and migration guidance for Amber Protocol releases.

## Current Release: `v1.6.0`

The current release line is **v1.6.0**.

### Environment Compatibility Matrix

The runtime expectations below derive directly from repository package metadata (`package.json`):

| Component | Required Version | CI Verification |
| --- | --- | --- |
| **Node.js** | `^20.19.0 \|\| ^22.12.0 \|\| >=23` | Tested on Node 20.x and 22.x |
| **npm** | `>=9.0.0` | Verified on npm 10.x |
| **Docusaurus Docs** | `3.10.2` | Static build with local search index |

## Release Changelog

For a full list of features, fixes, and conventional commit changes for each release, refer to the [CHANGELOG.md](https://github.com/Bandersnatch0x/amber-protocol/blob/master/CHANGELOG.md).

## Migration & Deprecation Notes

### Retirement of Legacy Hand-Written CLI References
In earlier development iterations (v1.0.0 through v1.2.0), hand-written CLI documents existed in `docs/CLI_REFERENCE.md` and `docs/api/cli-commands.md`. Those files contained contradictory command syntax and have been **fully retired**. The single authoritative source of truth for CLI commands is now `scripts/lib/command-registry.js`, which generates the [CLI Reference](/reference/cli).

### Unified Command Syntax
All public documentation uses the standardized invocation pattern:
```bash
amber <command> --target <repo>
```
Legacy prefix `amber-protocol` has been deprecated.

### Deprecated Commands (v1 Compatibility)
The following commands are marked deprecated and scheduled for removal in v2.0.0:
- `amber adoption` → Use [`amber audit`](/reference/cli/audit) and [`amber governance`](/reference/cli/governance).
- `amber profile inspect` → Use [`amber governance`](/reference/cli/governance). Note that `amber profile deployment` remains active and supported.
- `amber task`, `amber result`, `amber agent`, `amber team` → Replaced by core session and canonical artifact commands.
