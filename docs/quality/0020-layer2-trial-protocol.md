---
type: quality-record
title: 0020 Layer-2 trial protocol (public docs acceptance)
description: The durable, runnable protocol and record sheet for the two HUMAN trials that the 0020 public-docs acceptance contract requires and that Layer-1 gates cannot cover.
status: protocol-ready, trials unrun
date: 2026-09-28
---

# 0020 Layer-2 trial protocol — public documentation site

## Why this file exists

`0020-public-docs-acceptance-contract.md` defines the first-release acceptance for the public
documentation site in two layers:

- **Layer 1** — 10 zero-tolerance **mechanical** thresholds. All are now enforced, fail-on-planted-violation,
  by `scripts/verify-public-docs.js` (14 gates) and `scripts/verify-public-docs-browser.js`
  (real browser: axe in both themes, overflow, theme rendering, narrow-screen section navigation).
- **Layer 2** — two replayable **human** trials. Both remain **unrun**.

The contract itself lives in the local ticket store (`issues/0020-…`, gitignored), so before this file
a person could not run the Layer-2 trials from the repository. This is the tracked, runnable copy.
Tracking ticket: `issues/0062`.

> **An agent cannot stand in for either trial.** Trial 1 depends on a reader who is not the author and
> holds no prior context; trial 2 needs a reader who has not written the pages. A run performed by the
> author, or by an agent, must be labelled a **proxy run** and does **not** satisfy the acceptance.

---

## Preconditions (already mechanical — run these first)

```bash
npm run docs:build
npm run docs:verify              # 14 gates, incl. Scenario 1 + Gate 6 search-index parity
npm run docs:verify:browser      # rows 7 & 10 + Gate 7b (needs chromium + axe-core in apps/docs)
```

Gate 12 (Scenario 1) already asserts the walkthrough's five steps, its `expectedSignal`s, its
continuation links to the assurance/handoff half, and the four non-execution claims on
`apps/docs/docs/about/boundaries.md`. If those are red, fix the site before running the human trials.

---

## Trial 1 — new reader completes J0–J2 and states the boundary

**Reader profile:** a person who has **not** written the documentation and has no prior Amber context.

**Task (three outcomes, all required):**

1. Complete the adoption path from the site alone: `J0` audit → `J1` init/doctor → `J2` one real goal
   through `next`, plan/session state, and `handoff`.
2. State, **in their own words**, what Amber does **not** do (the non-execution boundary).
3. Hand the real task to a **fresh context** (new session/person/agent with no access to the original
   chat) and have it take **one correct next step**.

**Success criteria:** a session directory exists under `.amber/sessions/` with a readable
`manifest.json` and `timeline.jsonl`; the boundary statement matches the four non-claim boundaries
without prompting; the fresh context's next step is correct and evidence-backed.

**Fails if:** it proves only installation, `doctor`, or session creation, without a genuine
fresh-context continuation.

**Record:**

| Field | Value |
| --- | --- |
| Reader (role, not name) | |
| Date | |
| Starting state (commit, repo) | |
| Steps actually taken | |
| Boundary statement (verbatim) | |
| Fresh-context next step + evidence | |
| Verdict | PASS / FAIL |
| Missing artefacts (if any — name them) | |

---

## Trial 2 — experienced reader finds three commands by search

**Reader profile:** someone who has **not** written the pages; may be experienced with Amber.

**Task:** using only the site's own search box (not the page tree), locate the reference entries for
three exact commands — `audit`, `doctor`, `next`.

**Success criteria:** all three located via search; clicking the top `next` suggestion lands on the
`next` command reference.

**Note:** the mechanical half of this trial has already been run against the plugin's real client path
(`tokenize` → `smartQueries` → per-group query → `sortSearchResults`), 3/3. What remains is the human
half: a reader who did not write the pages.

**Record:**

| Field | Value |
| --- | --- |
| Reader (role, not name) | |
| Date | |
| Commands found (of 3) | |
| Landed page for `next` | |
| Verdict | PASS / FAIL |
| Missing artefacts (if any — name them) | |

---

## Recording the run

- Copy both record tables into `issues/0062`'s log with the date and the reading commit.
- If a trial fails, every failure becomes a **named** defect (a page/command artefact), and the fix
  lands as its own change — do not fold fixes into the acceptance record.
- Report **rounds passed and gaps found** together; a pass-rate-only report is not acceptable.
- A proxy run (author or agent) may be recorded for rehearsal value, but must be marked `proxy` and
  never counted as the human acceptance.

## Closure

`issues/0062` closes when **both** human halves above have been run by real people and recorded,
on top of the already-complete Layer-1 conditions.
