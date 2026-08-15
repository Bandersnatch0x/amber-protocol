# Post-mortem: Bookkeeping dates drift to the UTC day

Issue: 118
Title: Bookkeeping dates drift to the UTC day
Recurrence: 2
Date: 2026-08-15

## Symptom & evidence

- Observed: `amber session verify --execute` run on the evening of 2026-08-15 (UTC+8) refluxed evidence into `feature_list.json` F022 with `"date": "2026-08-14"` — the UTC calendar day at execution time, one day behind the operator's.
- Expected: bookkeeping dates record the day the operator saw, so an evening run stamps the local day (issue #118).
- Recurrence: after F024 replaced the UTC slice in the sites named by #118, review of the same branch found the identical `toISOString().slice(0, 10)` pattern still live in `scripts/lib/core/planning.js` (feature `updated` field, harness-evolution heading) and `scripts/changelog.js` (changelog date) — issue #122, same class, one slice later.

## Recurrence & why previous fixes failed

- Fix 1 (F024/#118): replaced the UTC slice with a shared `localIsoDate()` helper at the four sites the issue literally named (evidence reflux, learning booking, handoff Last Updated, context request id). Why it looked sufficient: every reproducible call site from the dogfood session was converted and unit-tested against local/UTC divergence. Why the class returned: the fix swept by issue scope, not by pattern — the raw UTC-slice idiom had been copy-pasted into sibling paths that #118 never exercised, and no guard existed to flag the idiom itself, so the untouched copies simply stayed.
- Fix 2 (this post-mortem's prevention, see below): converts the remaining three sites and, decisively, adds a hygiene test that greps `scripts/` for the raw idiom so the class cannot silently re-enter.

## Root-cause classification

- Primary: change-propagation-failure
- Secondary: verification-gap

The date-stamping logic existed as scattered copies; fixing the named copies did not reach the pattern's other dependents, and no test anchored the idiom, so the miss shipped silently.

## Prevention mechanism

- Mechanism: centralized-helper

One shared `localIsoDate()` (already landed in F024, `scripts/lib/core/text-utils.js`) is now the only way scripts produce a calendar day; the sweep removes the last raw copies, and the unit test pins both the helper's local-day semantics and the absence of the raw idiom in `scripts/`.

## Write-back record

- Surface: scripts/lib/core/text-utils.js (localIsoDate) — plus this post-mortem under docs/quality/break-loops/
- Test anchor: tests/unit/local-date-hygiene.test.js — "scripts/ contain no raw UTC calendar-day slice" and the localIsoDate divergence cases

## Verification

node --test tests/unit/local-date-hygiene.test.js — all tests pass (0 failed), including the repo-wide grep asserting no `toISOString().slice(0, 10)` remains under `scripts/`; the three #122 sites now import localIsoDate.
