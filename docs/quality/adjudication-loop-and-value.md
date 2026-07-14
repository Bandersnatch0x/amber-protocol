# Adjudication: Amber runtime loop + actual value

**Map:** [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)  
**Pass type:** grilling-style adjudication (subagent; human unavailable)  
**Product:** `amber-protocol@1.3.1` (evidence window 2026-07-10)  
**Machine summary:** [`adjudication-loop-and-value.json`](./adjudication-loop-and-value.json)  
**Date:** 2026-07-11  

> **Post-adjudication update (2026-07-14):** G1 (`next` last-mile) and G2 (template handoff) — the two gaps that block 完整 below — were subsequently **verified CLOSED** on a real non-product target repo via the weekly dogfood ritual (issue #54). See [`e2e-governance-loop-verify.md`](./e2e-governance-loop-verify.md) Findings G1/G2. The body below is the frozen 2026-07-11 adjudication; read it as the verdict at that date, not current status. The machine summary carries the matching `postAdjudicationClosures` note.

## Scope and rules

- Target: 3–30 person engineering teams that use coding agents heavily, need cross-session/person continuity, and require human review.
- Dual verdict dimensions only:
  1. **运行闭环:** `完整` | `部分闭环` | `未闭环`
  2. **实际价值:** `已验证` | `有合理价值但未验证` | `价值不足`
- Ground every decision in closed tickets **#28–#32** and their assets. Do **not** invent external adoption.
- Map bars for **价值已验证** (all required unless map Notes say otherwise):
  - Review/handoff time **−30%** vs no-Amber baseline
  - Plan/verify/approve/handoff Evidence completeness **≥90%**
  - Median human governance overhead **≤10 min AND** net benefit positive
  - **≥2** independent target repos + **≥10** real tasks  
  - Dogfood / stars / downloads **≠** verified

### Evidence corpus (treated as facts)

| Ticket | Asset | One-line fact |
|--------|-------|---------------|
| #28 Journey | [`user-journey-adoption-to-handoff.md`](./user-journey-adoption-to-handoff.md) | Main path commands executable; **G1** (`next` stops after approve); **G2** (init template handoff passes strict complete-check); adoption not in `next`; Web intentional partial (ADR-0007) |
| #29 Fresh-repo e2e | [`e2e-governance-loop-verify.md`](./e2e-governance-loop-verify.md) + [`.json`](./e2e-governance-loop-verify.json) | Success **closes**; rejects **hold**; verify-fail recovery **works**; cross-session handoff **works**; G1/G2 **reproduced** outside product repo; `loopJudgementHint: partial` |
| #30 Overhead | [`governance-overhead-measure.md`](./governance-overhead-measure.md) + [`.json`](./governance-overhead-measure.json) | Median modeled steady human governance **8.17 min ≤ 10**; ~10–11 active ops, ~4 repeat-entry; **net benefit not proven** |
| #31 External adoption | [`external-adoption-evidence.md`](./external-adoption-evidence.md) + [`.json`](./external-adoption-evidence.json) | 0 stars/forks; ~720 npm downloads/month (interest only); 0 external issue authors; **0** independent repos with repeated real tasks; **2×10 bar not met** |
| #32 Baseline comparison | [`baseline-net-value-comparison.md`](./baseline-net-value-comparison.md) | Unique: executed vs claim evidence, hash-chain ledger, dual gates, accept evidence gate, policy-deny verify, live handoff generator; re-wraps: AGENTS/wiki/plan/feature list; field net value **unverified** |

---

## 1. Grilling log

### Q1 — Does the success path close without operator tribal knowledge of terminal commands?

| | |
|--|--|
| **Recommended answer** | **No.** The full CLI sequence closes (accept + handoff with executed evidence), but `amber next` after approve reports complete and does **not** recommend `complete-check` / `session complete` / `accept` / `handoff`. |
| **Why** | #28 G1 (live smoke); #29 Path A reproduced on fresh non-product git targets (`next` after approve: complete true; no terminal recommendations). |
| **Counter-argument** | Demo scripts and CLI docs still describe the full path; a trained operator or agent that ignores `next` and follows `acceptance-demo.sh` can finish. That proves **command graph** closure, not **navigation-closed** loop. |

### Q2 — Are rejection and recovery paths real gates, or demo theater?

| | |
|--|--|
| **Recommended answer** | **Real.** Policy deny, claim-only failing strict, accept-without-evidence blocked, multi-gate requiring `--gate` all hold on fresh targets; verify-fail → re-verify recovery is auditable. |
| **Why** | #29 Paths B and C; machine log exit codes and timeline events. |
| **Counter-argument** | Controlled AFK temp repos with scripted commands are not multi-person field chaos. Gates are **reproducible under investigation**, not yet proven under adversarial or sloppy team use. Still sufficient to reject **未闭环**. |

### Q3 — Is cross-session / cross-person continuity actually closed?

| | |
|--|--|
| **Recommended answer** | **Partially.** Explicit `amber handoff` produces a live, useful handoff; completed sessions do not resurrect; a second session can start. Continuity is **not** forced by `next` or by complete-check (template handoff already “exists”). |
| **Why** | #29 Path D; #28 G2 (init scaffold satisfies presence checks). |
| **Counter-argument** | Target teams that institutionalize “always run handoff” may experience full continuity. Map continuity for heavy agent use still depends on a step that navigation and strict checks do not compel — so not **完整**. |

### Q4 — Does Evidence completeness under product semantics meet a ≥90% field bar?

| | |
|--|--|
| **Recommended answer** | **Unknown / not measured in field; product semantics alone are insufficient for the map bar.** Executed vs claim is enforced under `--strict`; handoff integrity is **not** (G2). No external Evidence completeness rate exists. |
| **Why** | #29 strict synthesis table; #28 G2; #31 no field Evidence metrics. |
| **Counter-argument** | If “Evidence” is defined only as “has executed verify + accept gate,” internal e2e success paths score high. Map wording includes plan/verify/approve/**handoff** completeness — G2 breaks honest measurement via complete-check alone. |

### Q5 — Is median human governance overhead ≤10 minutes with net benefit positive?

| | |
|--|--|
| **Recommended answer** | **Overhead ≤10 is plausible (modeled); net benefit is not proven.** Median **8.17 min** across three routes under an explicit human-judgment model; CLI is tens of seconds. Net vs no-Amber review/handoff savings: **unknown**. |
| **Why** | #30 aggregate table and confidence section; map requires **both** ≤10 **and** net positive for verified value. |
| **Counter-argument** | Modeled seconds for plan fill / dual approve may under- or over-state real HITL. Even if true wall-clock ≤10, overhead can still be pure cost if baseline review is already short. |

### Q6 — Has unique net value vs Issue+CI+AGENTS+checklist been established?

| | |
|--|--|
| **Recommended answer** | **Structurally yes for a core subset; field-proven no.** Hard-to-baseline additions: executed vs claim, hash-chain ledger, dual gate artifacts, accept-without-evidence refusal, policy default-deny local verify, regenerable handoff. Surrounding surface largely re-wraps. |
| **Why** | #32 capability matrix and “Net value judgment” table. |
| **Counter-argument** | Skeptic: feature_list + plans + routes are Issue/PR with more CLI friction. Adjudication accepts the skeptic on **scaffolds** but not on **evidence-grade + ledger + accept gate**, which baseline rarely stabilizes without custom tooling. |

### Q7 — Do external adoption signals unlock “价值已验证”?

| | |
|--|--|
| **Recommended answer** | **No.** Zero independent repos with repeated real tasks; zero external outcome metrics; stars/downloads are interest only; example adoption reports are read-only audits. **2×10 bar not met.** |
| **Why** | #31 threshold check table; JSON `meets2Repo10TaskBar: false`. |
| **Counter-argument** | Private untracked usage might exist. Rule: adjudication **must not invent** it. Absence of public/in-repo evidence keeps **已验证** closed. |

### Q8 — Could the loop still be called 完整 if operators always follow the demo?

| | |
|--|--|
| **Recommended answer** | **No for map purposes.** Map destination is teams that need reliable continuity and human review under agent-heavy work — product navigation and Evidence integrity are part of “runtime loop,” not optional polish. #29 explicitly advises against **完整** while G1/G2 remain. |
| **Why** | #29 “Implications for map adjudication”; #28 journey verdict one-liner. |
| **Counter-argument** | Strict product boundary (Web partial by ADR-0007) is intentional design, not a bug — true, and already accounted as **partial by design**, not as reason for **未闭环**. |

---

## 2. Dual verdict

### 运行闭环: **部分闭环**

| Field | Content |
|-------|---------|
| **Verdict** | **部分闭环** |
| **证据** | (#29) Success path closes with `accepted` + executed evidence + live handoff when the full command sequence is followed on fresh git targets. Rejection paths hold (policy deny, claim-only vs strict, accept without evidence, multi-gate `--gate`). Verify-fail recovery works with timeline trail. Cross-session handoff works after explicit handoff. (#28) Main path commands and durable artifacts exist for the greenfield journey. Machine hint: `loopJudgementHint: "partial"`. |
| **反证 against 完整** | G1: `amber next` after approve claims complete and omits terminal steps. G2: init template handoff satisfies complete-check presence. Adoption path not wired into `next`. Web is intentional partial loop (ADR-0007). Handoff not forced by navigation or strict check. |
| **反证 against 未闭环** | Core success/reject/recover/handoff are command-repeatable with inspectable artifacts outside the product repo — not vaporware or single-demo optimism only. |
| **置信度** | **High** (two independent investigations: journey + AFK e2e machine log; findings reproduce). |
| **Remaining risk** | Teams that only follow `next` will systematically skip accept/handoff quality; Evidence dashboards based on complete-check may greenwash template handoffs; multi-person process drift not field-tested. |

### 实际价值: **有合理价值但未验证**

| Field | Content |
|-------|---------|
| **Verdict** | **有合理价值但未验证** |
| **证据 (合理价值)** | (#32) Independent measurable additions hard for baseline to stabilize: executed vs claim verification, tamper-evident session ledger, dual gate records, accept blocked without evidence, policy-gated local verify, live handoff generator. (#30) Modeled median governance overhead **8.17 ≤ 10 min** suggests cost is not obviously disqualifying for ordinary routes. (#29) Operability of those guarantees on non-product targets. |
| **证据 (未验证)** | (#31) **0** independent repos with repeated real tasks; **0** external outcome measurements for −30% review/handoff or ≥90% Evidence completeness; 2×10 bar **not met**. (#30) Net benefit positive **not proven**. (#32) Field net value **unverified**. Stars 0 / forks 0 / ~720 downloads = interest only. |
| **反证 against 已验证** | No field pilot meeting map metrics; dogfood and npm downloads explicitly do not count. |
| **反证 against 价值不足** | Unique governance guarantees are real and enforceable under controlled conditions; not “only AGENTS re-wrap.” Overhead model does not show ≥10 min median as a hard fail. |
| **置信度** | **Medium–High** on structural uniqueness (high on #32 code-path comparison); **High** that verification bars are unmet; overall **medium** on “reasonable” because net benefit could still be negative if baseline review is already fast. |
| **Remaining risk** | Unique guarantees unused if G1 causes early stop; overhead + repeat-entry (~4 ops) could dominate; private non-use of npm downloads means interest ≠ pull. |

### Recommended dual line (authoritative)

```text
运行闭环: 部分闭环 | 实际价值: 有合理价值但未验证
```

---

## 3. Gaps ranked by impact × cost

Investigation estimates only — **do not implement** in this pass. Cost is engineering/investigation effort to close the *adjudication bar*, not a full product roadmap.

| Gap id | Impact | Cost to fix (est.) | Why it blocks 完整 / 已验证 |
|--------|--------|--------------------|-----------------------------|
| **G1** — `amber next` last-mile (complete-check → complete → accept → handoff) | **High** | **Low–Med** (lifecycle STEPS + focus rules) | Blocks **完整**: navigation-closed loop fails after approve; agents stop early → handoff/accept underused → continuity value unrealized. |
| **G2** — complete-check accepts init template handoff | **High** (Evidence integrity) | **Low–Med** (presence → freshness/content/hash checks) | Blocks honest **≥90% Evidence** and weakens **完整**: green strict checks without live handoff. |
| **V1** — No 2 independent repos × 10 real tasks with outcomes | **Critical** for 已验证 | **High** (external pilot design + instrumented use) | Blocks **已验证** directly; map bar explicit. |
| **V2** — No baseline-controlled −30% review/handoff measurement | **Critical** for 已验证 | **High** (paired tasks with/without Amber) | Blocks **已验证** and “net benefit positive”; #30 only models Amber-side cost. |
| **V3** — Net benefit unproven even if overhead ≤10 | **High** | **High** (depends on V1/V2) | Map requires overhead **and** net positive; #30 alone insufficient. |
| **N1** — ~4 repeat-entry ops (title/goal/verification restated) | **Med** | **Med** (generators / single SOT propagation) | Inflates overhead; risks pushing real HITL over 10 min even if model says 8.17. |
| **N2** — Multi-gate requires discovering `--gate` | **Med** | **Low–Med** (`next` + route inspect surfacing) | Friction and error path; contributes to partial navigability. |
| **A1** — Adoption path not wired into `next` | **Low–Med** (secondary journey) | **Med** | Secondary for greenfield loop; hurts “should we install?” → delivery continuity for existing repos. |
| **W1** — Web partial loop (ADR-0007) | **Low** for dual verdict (by design) | **N/A / product decision** | Does not force 未闭环; keeps full accept/handoff on intentional CLI surfaces. |

**Priority read for product:** close **G1+G2** to approach **完整**; run **V1+V2** pilots to approach **已验证**. Neither class alone upgrades both dimensions.

---

## 4. What would change the verdict (falsifiers)

### Toward 运行闭环 = 完整

All of the following would need to hold under independent re-check (preferably fresh-repo e2e):

1. After `session approve`, `amber next` recommends the remaining terminal sequence (at least complete-check → complete → accept → handoff) until done — **G1 closed**.
2. `complete-check --strict` **fails** while handoff is still init template / not regenerated from live state — **G2 closed**.
3. Success, reject, recover, and cross-session handoff still pass as in #29.
4. (Optional but strengthening) Handoff or equivalent continuity artifact is not skippable for “strict complete” when map Evidence includes handoff.

**Would not upgrade alone:** more docs, higher demo polish, or Web gaining more CLI mirrors without G1/G2 fixes.

### Toward 运行闭环 = 未闭环

Any of:

1. Success path cannot reach `accepted` with executed evidence on a fresh git target under the documented sequence.
2. Rejection gates routinely bypassable without explicit policy changes (claim-only accepted as executed; accept without evidence succeeds).
3. Verify-fail leaves the session unrecoverable or without audit trail in normal use.
4. Cross-session handoff cannot produce a non-scaffold artifact that a second session/person can use.

### Toward 实际价值 = 已验证

**All** map bars, not cherry-picked:

1. ≥2 independent non-product target repos with sustained use.
2. ≥10 real tasks cumulative with durable artifacts (not one-shot AFK e2e).
3. Measured review/handoff time **−30%** vs no-Amber baseline on comparable tasks.
4. Plan/verify/approve/handoff Evidence completeness **≥90%** under definitions that do not count template handoff as complete (G2-aware).
5. Median human governance overhead **≤10 min** (preferably field HITL, not only model) **and** demonstrated **net benefit positive**.

Stars, downloads, internal dogfood session counts, and read-only `docs/examples` adoption audits **do not** flip this.

### Toward 实际价值 = 价值不足

Any strong combination of:

1. Field pilots show overhead ≥ savings (net negative) with no compensating quality gain.
2. Teams drop Amber after trial because unique guarantees are unused or G1 makes the product feel unfinished relative to Issue+CI.
3. Structural uniqueness collapses (e.g. baseline tooling commonly provides executed-evidence + ledger + accept gates equally well, and Amber adds only template re-wraps).
4. Independent pilots cannot complete real tasks under Amber without constant maintainer intervention.

Current evidence is **not** sufficient to force **价值不足**: unique guarantees and operable gates still support **有合理价值但未验证**.

---

## 5. Decision-tree walk (summary)

```text
Does command-level success + reject + recover + handoff work on fresh targets?
  YES (#29) → not 未闭环
Does navigation + Evidence integrity close without tribal knowledge?
  NO (G1, G2) → not 完整
  ⇒ 运行闭环 = 部分闭环

Is there structural unique value vs Issue+CI+AGENTS?
  YES (#32 core guarantees) → not 价值不足 (by default)
Are map verification bars (2×10, −30%, ≥90% Evidence, ≤10+net+) met?
  NO (#30 net unproven, #31 external zero) → not 已验证
  ⇒ 实际价值 = 有合理价值但未验证
```

---

## 6. Assets referenced

| Path | Role |
|------|------|
| `docs/quality/user-journey-adoption-to-handoff.md` | #28 journey + G1/G2 |
| `docs/quality/e2e-governance-loop-verify.md` / `.json` | #29 AFK e2e + partial hint |
| `docs/quality/governance-overhead-measure.md` / `.json` | #30 overhead model |
| `docs/quality/external-adoption-evidence.md` / `.json` | #31 external bar fail |
| `docs/quality/baseline-net-value-comparison.md` | #32 unique vs re-wrap |
| `docs/quality/adjudication-loop-and-value.json` | Machine-readable dual verdict |

---

## 7. Adjudication statement

For map #27, Amber Protocol (current evidence window) is adjudicated as:

**运行闭环: 部分闭环 — 实际价值: 有合理价值但未验证**

No external adoption was invented. Confidence is high on loop partiality and on unmet verification bars; medium on long-run net ROI for the target team until pilots exist.
