# Generate a handoff

`handoff` regenerates `session-handoff.md` from live state so the next person or agent can
continue without the old chat. It also produces a portable bundle. The handoff is only real
continuity evidence once it reflects actual verification, not the init scaffold.

## Sub-features

- `handoff-live` regenerates `session-handoff.md` from the target's live state.
- `handoff-scaffold` shows the init scaffold's placeholder state before any evidence exists.
- `handoff-evidence` reflects recorded feature evidence once `feature verify` has run.
- `handoff-bundle` writes a portable handoff bundle directory.
- `handoff-validate` validates a bundle directory.

## How to get to it (user POV)

- Run `amber handoff --target <repo>` to regenerate the live handoff document.
- Run `amber handoff bundle --target <repo> [--output-dir <dir>]` for the portable bundle.
- Run `amber handoff validate --target <repo> --bundle-dir <dir>` to check a bundle.

## Driving it with amber

Preconditions:

- A disposable target is `init`-ed. `session-handoff.md` exists as the init scaffold.

- **Scaffold state.** Run `node scripts/amber.js handoff --target "$T"` on a fresh target, then
  read `"$TMPD/session-handoff.md"`. The `Runtime / Verification State` section reads
  `Command: not run yet` and `Result: pending`, and `Verification Evidence` says
  `No verification evidence recorded yet.` — this is the scaffold, not real continuity.
- **Record evidence.** Run
  `node scripts/amber.js feature verify --feature F001 --command "node -e 0" --result "exit 0" --target "$T" --yes`.
  Output confirms `Evidence recorded for feature: F001`. Exit code `0`.
- **Live handoff.** Run `node scripts/amber.js handoff --target "$T"` again and re-read the file.
  The verification section now shows your `Command:` and `Result:` with a date — the document
  is no longer a scaffold.
- **Read it back.** `sed -n '/## Runtime/,/## Feature/p' "$TMPD/session-handoff.md"` prints the
  populated section. This read-back is the proof; the command's `Created: 1` line is not.
- **Bundle.** Run
  `node scripts/amber.js handoff bundle --target "$T" --output-dir "$TMPD/.amber/handoff/latest"`.
  The directory holds `README`, `summary`, evidence, next-actions, risks, recovery commands, and
  a manifest. Run `amber handoff validate --target "$T" --bundle-dir …` to validate it.

## Gotchas

- A handoff document counts as continuity evidence only when it is **non-scaffold**. Amber
  rejects content matching `/Command:\s*not run yet/`, `/Result:\s*pending/` with
  `/not recorded/`, and the "scaffolded" banner. A regenerated handoff that still says
  `Command: not run yet` means no feature evidence exists yet.
- The handoff's verification section comes from `feature_list.json` evidence
  (`amber feature verify`), **not** from the session timeline (`amber session verify`). Running
  only the session-side verify leaves the handoff looking empty.
- `handoff` is not a typed mutation — it needs no `--yes`.
- Do not hand-edit `session-handoff.md` to make a check pass; drive `feature verify` and
  regenerate.
