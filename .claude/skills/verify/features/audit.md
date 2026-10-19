# Audit a repository

Audit lets a maintainer inspect a target repository **read-only** and learn what Amber would
add to it: which starter files are missing, which docs already exist, whether anything
conflicts, and the next safe command. It never writes to the target.

## Sub-features

- `audit-empty` reports an unadopted repo as `unharnessed-target-repo` with its missing files.
- `audit-harnessed` reports an adopted repo as `harnessed-target-repo` with its existing files.
- `audit-summary` prints a one-screen counts summary instead of the full listing.
- `audit-json` emits the same findings as machine-readable JSON.

## How to get to it (user POV)

- Run `amber audit --target <repo>` to read the full diagnosis.
- Add `--summary` for the counts-only view.
- Add `--json` to consume the findings programmatically.

## Driving it with amber

Preconditions:

- A disposable target directory exists (see the map's baseline).
- The target has not been `init`-ed yet, so it starts unadopted.

- **Audit an unadopted repo.** Run
  `node scripts/amber.js audit --target "$T"`.
  The output reads `Read-only: true`, `Target type: unharnessed-target-repo`, and lists
  `Missing Amber starter files:` with entries such as `AGENTS.md`, `CLAUDE.md`, and
  `docs/wiki/index.md`. Exit code `0`.
- **Audit an adopted repo.** Run `node scripts/amber.js init --target "$T"` first, then
  `node scripts/amber.js audit --target "$T"`.
  The type line now reads `harnessed-target-repo` and the missing list shrinks.
- **Summary view.** Run `node scripts/amber.js audit --target "$T" --summary`.
  Output is a handful of `Key: count` lines (`Missing Amber starter files: 20`,
  `Conflicts: 0`, `Unknowns: …`).
- **Machine-readable view.** Run `node scripts/amber.js audit --target "$T" --json`.
  A JSON object with the same findings; assert on its fields rather than the text.
- **Proof of read-only.** Snapshot the target's file list before and after an audit
  (`find "$TMPD" -type f | sort`) and capture both. The two lists are identical.

## Gotchas

- Audit is read-only (`Read-only: true`); it never creates files. Prove this by diffing the
  directory listing, not by trusting the label.
- A `Suggested patches requiring approval:` section lists *proposals*; audit does not apply
  them. A later `init` still only creates missing files.
- Exit code is `0` even for an unadopted repo — "missing files" is a finding, not a failure.
- `--summary` and the full listing are two views of one run; do not treat them as separate
  commands to verify independently.
