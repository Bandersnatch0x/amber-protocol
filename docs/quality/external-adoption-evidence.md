# Research: external adoption and outcome evidence

**Ticket:** [核查 Amber 的外部采用与实际结果证据](https://github.com/Bandersnatch0x/amber-protocol/issues/31)  
**Map:** [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)  
**Machine log:** [`external-adoption-evidence.json`](./external-adoption-evidence.json)  
**Date:** 2026-07-10  

## Question

> 除产品仓库内部 Dogfooding 外，是否存在独立目标仓库、重复使用、用户反馈、复核或交接耗时改善、Evidence 完整率改善、愿意持续承担使用成本等证据；这些证据是否达到 2 个独立仓库和 10 个真实任务的验证门槛？

## Sources checked (primary)

| Source | What we looked for |
|--------|--------------------|
| GitHub `Bandersnatch0x/amber-protocol` | stars, forks, watchers, issue authors |
| npm `amber-protocol` | published versions, download counts |
| `docs/examples/**` adoption reports | independent target usage vs one-shot audits |
| Product `.amber/sessions` | dogfood only (in-repo) |
| Closed maps #6/#14 + tickets #28/#29 | internal capability proof, not external value |

## Findings

### Interest signals (not value proof)

- **GitHub:** 0 stars, 0 forks (captured in JSON at collection time).  
- **npm:** package published through **1.3.0** (local workspace also 1.3.1); download counts recorded in JSON when API reachable.  
- Map Notes: stars/downloads = **interest only**.

### Independent target repos with repeated real tasks

| Candidate | What it is | Counts toward 2×10 bar? |
|-----------|------------|-------------------------|
| Product repo dogfood | Internal | **No** (map excludes dogfood for “价值已验证”) |
| `docs/examples/adoptions/stockagents-*.md` | Read-only adoption **audit** of a local path; “No target project files were initialized” | **No** — not sustained task use |
| `docs/examples/go-stock-dev-adoption-report.md` | Same: read-only audit, unharnessed target | **No** |
| Other `docs/examples/*adoption*` | Generated sample/demo reports | **No** |
| Fresh temp repos in #29 e2e | Controlled AFK verification | **No** — not external teams |

**Independent repos with repeated real use documented:** **0**  
**Real tasks outside product dogfood with outcome metrics:** **0**

### User feedback / time / Evidence completeness improvements

- No public issues from external authors documenting review-time reduction, handoff improvement, or Evidence completeness ≥90%.  
- No paid-willingness or “we keep using this weekly” artifacts found.  
- Internal e2e (#29) and overhead model (#30) show **operability**, not external outcomes.

### Threshold check

| Map bar | Required | Observed | Met? |
|---------|----------|----------|------|
| Independent target repos | 2 | 0 with repeated real use | **No** |
| Real tasks cumulative | 10 | 0 external | **No** |
| Review/handoff −30% | measured | not measured externally | **No** |
| Evidence completeness 90% | measured in field | not measured externally | **No** |

## Answer

**No.** Beyond product dogfooding and interest signals (npm publish, example audit reports), there is **no durable evidence** of independent target repositories with repeated real tasks, nor measured improvements in review/handoff time or Evidence completeness. The **2 repos / 10 tasks** bar for “价值已验证” is **not met**.

## Confidence

**High** that the public + in-repo artifact set does not contain the required external outcome evidence.  
**Medium** that private untracked usage might exist — not visible here; adjudication must not invent it.
