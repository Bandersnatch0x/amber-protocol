---
id: target-repository
title: "Target Repository & Isolation"
sidebar_label: "Target Repository"
description: "How Amber interacts with target codebases via --target without polluting user files."
---

# Target Repository & Isolation

A **Target Repository** is the codebase being analyzed, governed, or developed with Amber Protocol assistance.

## Scoping with `--target`

Every Amber command that inspects or mutates state requires an explicit `--target <path>` flag (or defaults to the current working directory `.` when explicitly allowed):

```bash
amber doctor --target path/to/your/repo
```

## Boundary Invariants

1. **Confined Writes**: Amber writes only to the `.amber/` directory inside the target repository. It never creates arbitrary dotfiles, temp directories, or caches in parent folders or user directories.
2. **Non-Destructive Scaffolding**: `amber init` and `amber wiki` create missing files only. Existing user files (such as `README.md`, `package.json`, or `.git/`) are never overwritten.
3. **No Target Code Execution**: Amber never executes arbitrary scripts in your target repository (e.g. running `npm test`, `cargo build`, or test binaries) unless explicitly asked via a dedicated verification flag (`--execute`).
4. **Path Sanitization**: All file paths are strictly resolved relative to the target repository root to prevent path traversal attacks (`../`).
