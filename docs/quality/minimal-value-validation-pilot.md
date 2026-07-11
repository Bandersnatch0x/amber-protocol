# Prototype: minimal pilot to close value-evidence gaps

**Ticket:** [设计关闭价值证据缺口的最小验证试点](https://github.com/Bandersnatch0x/amber-protocol/issues/33)  
**Map:** [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)  
**Depends on adjudication:** [裁决 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/34) → **部分闭环** + **有合理价值但未验证**  
**Date:** 2026-07-11  
**Constraint:** design only — do not run the pilot in this map; no product code changes.

## Question

> 根据当前裁决暴露的证据缺口，怎样用 2 个独立目标仓库、累计 10 个真实任务，以最少干预测量复核与交接耗时、Evidence 完整率、人工治理开销和净收益，并得到可接受或否定 Amber 实际价值的清晰停止条件？

## Evidence gaps this pilot must close (from #34)

| Gap | Blocks | Pilot response |
|-----|--------|----------------|
| **V1** 0× independent repos / 0× real tasks | 已验证 | 2 independent repos, 10 real tasks |
| **V2** no −30% review/handoff baseline | 已验证 | paired timing Amber vs no-Amber |
| **V3** net benefit unproven | 已验证 | time-saved − governance overhead |
| **G2-aware Evidence ≥90%** | honest 完整率 | scorecard not complete-check alone |
| **N1** overhead only modeled | field ≤10 min | wall-clock human ops log |
| G1/product fixes | 完整 loop | **out of pilot** (map forbids product work); note as confounder |

## Design principles (minimal intervention)

1. **No product changes** — use Amber as shipped (document G1/G2 workarounds in operator card).  
2. **Two repos only** — already agent-using teams, not greenfield toys.  
3. **Ten tasks total** — split 5+5 across repos (or 6+4 if one is busier).  
4. **Paired baseline** — each task has Amber path **or** matched no-Amber twin on similar work; prefer **within-team A/B by week**, not synthetic microbench only.  
5. **One sheet + git artifacts** — avoid new SaaS; use CSV/Markdown in a private pilot log repo.  
6. **Stop early** if falsifiers fire (see stop conditions).

## Repo & task selection criteria

### Independent target repos (n=2)

| Criterion | Rule |
|-----------|------|
| Independence | Not `amber-protocol` product repo; not same mono-repo |
| Team | 3–30 eng, already uses coding agents weekly |
| Review culture | PRs or equivalent human review required |
| Willing | Commit to 5 real tasks + timing honesty over 2–4 weeks |
| Stack | Prefer Node or mixed with `npm test` (or document alt verify allow-list) |

**Suggested profile (not locked names):** one application service repo + one library/tooling repo; different product owners if possible.

### Real tasks (n=10)

| Allowed | Disallowed |
|---------|------------|
| bugfix / small feature / safe refactor that would ship anyway | Synthetic “touch README” tasks |
| Must open PR or equivalent review surface | Tasks that skip human review |
| Must produce code change outside `.amber/` | Pure docs of Amber itself |

Tag each task: `bugfix-quick` | `feature-standard` | `refactor-safe` (or baseline equivalent).

## Protocol

### Phase 0 — Setup (≤1 day / repo)

1. Read-only `amber adoption report` (optional).  
2. `amber init` only with team consent; do not overwrite user AGENTS without approval.  
3. Operator card one-pager: full command sequence including **session complete → accept → handoff** (G1 workaround); regenerate handoff before calling complete-check honest (G2).  
4. Train one **timer role** (can be same as author) and one **reviewer role**.

### Phase 1 — Baseline week (no Amber) — 4 tasks (2 per repo)

For each task record:

| Field | Definition |
|-------|------------|
| `T_impl` | Author active coding/agent time (exclude waiting) |
| `T_review` | Reviewer wall time to first approve/request-changes complete enough to merge policy |
| `T_handoff` | Time for next person to resume (or self next-day resume) from Issue/PR/chat only |
| `E_base` | Checklist score 0–1: plan/intent written? verify command run? approval recorded? handoff note exists? |

No Amber commands.

### Phase 2 — Amber week — 6 tasks (3 per repo)  → total 10 with baseline

Full path (operator card):

`plan → gate --confirm → session start --feature → (work) → session verify --execute → session approve --gate … → complete-check --strict → session complete → accept → handoff`

Record:

| Field | Definition |
|-------|------------|
| `T_impl` | same as baseline |
| `T_review` | same |
| `T_handoff` | resume from **regenerated** `session-handoff.md` + PR |
| `T_gov` | wall-clock of human governance ops only (plan fill, gates, approve, complete/accept/handoff) — stopwatch or timestamped checklist |
| `E_amber` | Evidence scorecard (below), not complete-check alone |

### Evidence completeness scorecard (G2-aware)

Each task scores 1 point per item (max 6); **completeness = points/6**.

1. Plan exists with non-empty Verification  
2. Plan `User Confirmation: confirmed`  
3. Timeline has `stage_completed` with `executed: true`  
4. Timeline has `gate_passed`  
5. Feature has non-empty `evidence[]`  
6. `session-handoff.md` content is **post-handoff** (contains verify command result or session id; **not** init scaffold wording)

**Target:** mean `E_amber` ≥ **0.90** across Amber tasks.

### Derived metrics

| Metric | Formula | Map bar |
|--------|---------|---------|
| Review time change | median(`T_review_amber`) / median(`T_review_base`) − 1 | ≤ **−30%** |
| Handoff time change | median(`T_handoff_amber`) / median(`T_handoff_base`) − 1 | ≤ **−30%** (either review or handoff may be primary; **both reported**; **pass if at least one ≤−30% and the other not worse than −10%**, else fail — conservative: **require both ≤−30%** for “已验证”) |
| Evidence completeness | mean(`E_amber`) | ≥ **0.90** |
| Governance overhead | median(`T_gov`) minutes | ≤ **10** |
| Net benefit | median(`T_review_base + T_handoff_base − T_review_amber − T_handoff_amber − T_gov`) | **> 0** minutes |

## Minimum intervention measurement kit

| Artifact | Location | Owner |
|----------|----------|-------|
| Task log CSV | private pilot log (or spreadsheet) | timer role |
| Columns | `repo,task_id,phase,route,T_impl,T_review,T_handoff,T_gov,E_score,notes,pr_url` | |
| Amber artifacts | stay in target repos (session dirs, feature_list, handoff) | authors |
| Weekly rollup | one Markdown table | facilitator |
| No new product features | — | — |

Optional: run product `scripts/demo/e2e-governance-loop-verify.js` once per repo after init as **smoke**, not as a counted task.

## Roles & effort budget

| Role | Effort |
|------|--------|
| Facilitator | ~2h setup + 1h/week rollup × 3 weeks |
| Author (per task) | normal work + ≤15 min timing discipline |
| Reviewer | normal review + note clock time |
| **Total facilitator budget** | **≲ 8 hours** end-to-end |

## Stop conditions

### Accept “价值已验证” (all must hold)

1. **2** independent repos completed ≥**5** counted real tasks each (or 6+4 with both ≥4) and **total ≥10**.  
2. Review **and** handoff median time each **≤ −30%** vs baseline phase (same team).  
3. mean Evidence scorecard **≥ 0.90** on Amber tasks.  
4. median `T_gov` **≤ 10** minutes.  
5. Net benefit **> 0** (definition above).  
6. No critical process abandonment (team did not drop Amber mid-pilot for >50% of remaining tasks).

### Reject toward “价值不足” (any one sufficient)

1. Net benefit **≤ 0** on the 10-task set **and** neither review nor handoff improves by ≥15%.  
2. median `T_gov` **> 15** minutes (hard fail above model).  
3. mean Evidence scorecard **< 0.70** despite operator card.  
4. Team abandons Amber for process reasons (not one-off emergencies) on **≥3** scheduled tasks.  
5. Unique guarantees unused: **≥50%** Amber tasks only claim-verify or skip accept/handoff even after coaching.

### Stay “有合理价值但未验证” (inconclusive)

- Sample incomplete (<10 tasks or <2 repos).  
- Metrics mixed (e.g. overhead ≤10 and unique gates used, but −30% not met).  
- Confounders dominate (major product G1/G2 fixed mid-pilot, team change, etc.).

### Early stop (after 6 Amber+baseline tasks combined)

- If first 3 Amber tasks already show median `T_gov` > 15 **and** no review improvement → **early reject**.  
- If first 3 Amber tasks already show both −30% bars and E≥0.90 → **continue to 10** for confirmation (do not early-accept).

## Confounders to document (not “fix” in pilot)

- G1: operators may skip accept/handoff if they trust `next` — operator card mandatory.  
- G2: complete-check green ≠ handoff quality — scorecard item 6.  
- Learning effect: Amber week after baseline may be faster for unrelated reasons — note calendar order; optional swap order on repo B.  
- Task difficulty imbalance — pre-tag S/M complexity; report metrics stratified.

## Deliverables when pilot ends

1. Filled task log (10 rows minimum).  
2. Rollup Markdown with the five derived metrics + stop-condition outcome.  
3. Recommendation for product backlog (G1/G2 only if pilot shows they blocked metrics — still separate from this map).  
4. Update map #27 destination only via a **new** effort if re-adjudicating value.

## Answer (design summary)

Use **2 willing agent-using repos**, **5 real tasks each (10 total)**, **baseline week then Amber week**, stopwatch fields for review/handoff/governance, and a **6-point G2-aware Evidence scorecard**. Pass “价值已验证” only if −30% review **and** handoff, E≥0.90, gov≤10 min, net>0, and full 2×10 sample. Fail toward 价值不足 on net≤0 with weak savings, gov>15, E<0.70, or abandonment. Otherwise remain 有合理价值但未验证.

## Confidence

Design completeness: **high** relative to map bars.  
Field outcome: **unknown** (by design not run here).
