# Handoff: Execute the Amber value-validation pilot (#33 design)

**For:** next agent / human facilitator starting the external value pilot  
**Not for:** more product coding on G1/G2 (done and shipped)  
**Date:** 2026-07-11  
**Product at handoff:** `amber-protocol@1.3.1` tree; commit `2193583` on `master` (pushed)

---

## Goal (destination)

Run the **minimal external pilot** designed in:

- [`minimal-value-validation-pilot.md`](./minimal-value-validation-pilot.md)  
- Closed ticket: [设计关闭价值证据缺口的最小验证试点](https://github.com/Bandersnatch0x/amber-protocol/issues/33)  
- Parent map (closed): [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)

**Success for this handoff’s workstream:** produce field metrics that can re-adjudicate **实际价值** from  
`有合理价值但未验证` → either `已验证` or `价值不足` (or stay inconclusive).

This is **field operations + measurement**, not product feature work.

---

## Context already decided (do not re-litigate)

| Item | Verdict / fact | Source |
|------|----------------|--------|
| Runtime loop (pre-fix) | 部分闭环 | #34 adjudication |
| Runtime loop (post-fix CLI) | G1/G2/N2/A1 fixed; e2e `loopJudgementHint: closed-cli` | commit `2193583`, e2e harness |
| Actual value | **有合理价值但未验证** until pilot | #31/#32/#34 |
| Value bar | 2 independent repos, 10 real tasks; review **and** handoff ≤−30%; Evidence mean ≥0.90; gov median ≤10 min; net benefit >0 | map #27 Notes + pilot design |
| Dogfood / stars / downloads | **Do not** count as verified | map Notes |

### Product fixes since the pilot design was written

Update the pilot’s “operator card” section: G1/G2 are **no longer workarounds-required** on current master.

| Gap | Status after `2193583` | Pilot implication |
|-----|------------------------|-------------------|
| G1 `next` last-mile | Fixed: approve → handoff → complete-check → session complete | Operator card can follow `amber next` |
| G2 template handoff | Fixed: strict complete-check fails on scaffold | Scorecard item 6 still useful as field QA |
| N2 gate ids | Fixed: next names real `--gate` | Less friction |
| A1 audit→init | Fixed for existing repos | Phase 0: `next` may say audit first |

Still **out of pilot** unless ADR changes: Web cannot approve/complete/accept/handoff (ADR-0007).

---

## What to do next (ordered)

### Phase 0 — Recruit & setup (facilitator)

1. Pick **2 independent target repos** (not `amber-protocol`; not same monorepo). Criteria in pilot design §Repo selection.  
2. Get written consent: 5 real tasks each, honest timing, PR review culture.  
3. Per repo (with consent):
   - Optional: `amber adoption report --target <repo> --output-dir …`
   - Follow `amber next` → likely `audit` then `init` on existing projects  
   - Do **not** overwrite user AGENTS without approval  
4. Install pilot log: private sheet or CSV with columns from design §Minimum intervention kit.  
5. Assign **timer** + **reviewer** roles; print operator card (below).

### Phase 1 — Baseline week (4 tasks total, 2 per repo)

No Amber on the task path. Record `T_impl`, `T_review`, `T_handoff`, `E_base` per design.

### Phase 2 — Amber week (6 tasks total, 3 per repo)

Use **current** CLI path (follow `amber next` when unsure):

```text
plan → gate --confirm → session start --feature
  → (implement) → session verify --execute --command "npm test" (or allow-listed cmd)
  → session approve --gate <id from next>
  → handoff → complete-check --strict → session complete
  → accept → handoff (refresh)
```

Record `T_impl`, `T_review`, `T_handoff`, `T_gov`, `E_amber` (6-point scorecard in pilot design).

### Phase 3 — Rollup & stop conditions

Compute metrics in pilot design §Derived metrics. Apply **Accept 已验证** / **Reject 价值不足** / **Inconclusive** / **Early stop** exactly as written there.

### Phase 4 — Close the loop on the tracker

1. File results under `docs/quality/` (e.g. `pilot-value-validation-results.md` + CSV).  
2. Comment on closed map #27 or open a short follow-up issue with the dual-verdict update.  
3. Do **not** invent metrics; if sample incomplete, mark inconclusive.

---

## Operator card (ship with pilot)

```text
Amber ordinary-task path (post-2193583)
1. amber next --target .
2. Follow remedy (audit/init/plan/gate/session as directed)
3. After implement: amber next  → verify --execute
4. amber next  → approve --gate <printed id>   # human; avoid --yes unless policy allows
5. amber next  → handoff
6. amber next  → complete-check --strict
7. amber next  → session complete
8. amber next  → accept --plan <path>
9. amber handoff --target .   # refresh after accept
10. Stop timer for T_gov on governance-only steps (not coding)
```

Evidence scorecard (each 1 point, /6): plan Verification non-empty; User Confirmation confirmed; executed stage_completed; gate_passed; feature.evidence non-empty; handoff is **live** (contains verify result / session id, not init scaffold).

---

## Artifacts to read first

| Path | Why |
|------|-----|
| `docs/quality/minimal-value-validation-pilot.md` | Full protocol & stop conditions |
| `docs/quality/adjudication-loop-and-value.md` | Dual verdict + gap table |
| `docs/quality/external-adoption-evidence.md` | Why pilot is required (0×2×10 today) |
| `docs/quality/governance-overhead-measure.md` | Modeled 8.2 min overhead (calibrate, don’t treat as field) |
| `docs/quality/e2e-governance-loop-verify.md` + harness | CLI operability proof |
| `docs/CLI_REFERENCE.md` (`next` section) | Lifecycle string |

---

## Blockers / needs human

| Blocker | Owner |
|---------|--------|
| Choose real team/repos (cannot invent) | Product owner / facilitator |
| Consent for timing data | Repo maintainers |
| Prefer Node/`npm test` or extend verify allow-list carefully | Facilitator + security sense |
| Private pilot log storage | Facilitator |

**Hard stop for agents:** do not claim 价值已验证 without the filled 10-task log meeting all pass conditions.

---

## Verification state at handoff (item 1–2 done)

| Check | Result |
|-------|--------|
| Push `2193583` to `origin/master` | Done |
| Temp junk removed | Done |
| `node scripts/demo/e2e-governance-loop-verify.js` | successClosed=true; highFindings=[]; loopJudgementHint=closed-cli |
| Focused tests lifecycle/completion/next | 39 pass / 0 fail (2026-07-11) |
| Full `npm test` | See contemporaneous run note in session handoff / CI |

---

## Recovery if stuck

1. Re-read this file + pilot design; don’t redesign the map.  
2. If product regressions on G1/G2: re-run e2e harness; file a **new** bug issue (map #27 stays closed).  
3. If recruitment fails: stop as **inconclusive**, document attempts, do not force synthetic tasks.

---

## Next action (single)

**Recruit two willing independent repos and open the Phase 0 setup checklist in `minimal-value-validation-pilot.md`.**
