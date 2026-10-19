# Adopt and check health

`init` adds Amber's starter files to a target repository without overwriting anything that
already exists; `doctor` then reports whether the adopted repo is internally consistent. Together
they are the adopt-and-verify loop: scaffold, then prove the scaffold is healthy.

## Sub-features

- `init-scaffold` creates the missing starter files and reports what it added and skipped.
- `init-idempotent` re-running `init` creates nothing new and reports skips.
- `doctor-healthy` reports `Errors: 0` for a well-formed adopted repo.
- `doctor-detects-breakage` reports errors when a required file is removed or corrupted.
- `doctor-repo-self` reports this repository's own health (`Target type: product-repo`).

## How to get to it (user POV)

- Run `amber init --target <repo>` to adopt a repository.
- Run `amber doctor --target <repo>` to check a repository's health.
- Run `amber doctor --target .` from this repo to check Amber itself.

## Driving it with amber

Preconditions:

- A disposable, empty target directory exists.

- **Scaffold.** Run `node scripts/amber.js init --target "$T"`.
  Output lists `+ <path>` lines (`AGENTS.md`, `CLAUDE.md`, `feature_list.json`,
  `session-handoff.md`, `docs/wiki/…`, `routes/…`) followed by `Skipped: 0`. Exit code `0`.
- **Confirm the files landed.** Run `ls "$TMPD"` and `ls "$TMPD/docs/wiki"`.
  The scaffolded files are present on disk — the stdout `+` lines alone are not proof.
- **Idempotency.** Run `node scripts/amber.js init --target "$T"` a second time.
  Now `Skipped:` equals the file count and no `+` lines appear.
- **Healthy doctor.** Run `node scripts/amber.js doctor --target "$T"`.
  Every check is `[PASS]` and the last line is `Errors: 0`. Exit code `0`.
- **Detect breakage.** Delete a required file (`rm "$TMPD/session-handoff.md"`) and re-run
  doctor. The corresponding check flips to `[FAIL]` and `Errors:` becomes non-zero.
- **Repo self-check.** Run `node scripts/amber.js doctor --target .` from this repository.
  `Target type: product-repo` with product checks (`feature_list.json`, `plugin-manifests`,
  `wiki-structure`, …) all `errors=0`.

## Gotchas

- `init` is idempotent: it only creates missing files and never overwrites. Verify by reading
  the target, not by re-reading the `Skipped:` count alone.
- `init` prints a `WARNING: CLAUDE.md was created` line — Claude Code will read that file next
  session. It is expected, not an error.
- `doctor` on a target is read-only; it never repairs. A `[FAIL]` means the caller must fix the
  file.
- `doctor` distinguishes `harnessed-target-repo` (adopted) from `product-repo` (Amber's own
  tree) — read the `Target type:` line before interpreting the checks.
