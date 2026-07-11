# Measurement: Amber human governance overhead

**Ticket:** [测量 Amber 的人工治理开销与重复录入](https://github.com/Bandersnatch0x/amber-protocol/issues/30)  
**Map:** [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)  
**Product:** `amber-protocol@1.3.1`  
**Machine log:** [`governance-overhead-measure.json`](./governance-overhead-measure.json)  
**Runner:** `node scripts/demo/measure-governance-overhead.js`  
**Date:** 2026-07-10  

## Question

> 以 bugfix-quick、feature-standard 和 refactor-safe 的代表性任务为样本，Amber 新增了多少主动人工操作、审批和重复录入时间；现有生成器、Next 导航和风险分级能否把普通任务的中位人工治理开销控制在 10 分钟内并保持净收益为正？

## Method

- Fresh **git** temp targets per route (not product repo).
- Real CLI wall-clock for each Amber governance command.
- **Human judgment model** for ops that must stay human (plan fill, dual approvals, recover from G1, handoff). Coding/implement time **excluded**.
- Steady-state excludes one-time init review amortization.

### Human judgment model (seconds)

| Op | s | Notes |
|----|---|--------|
| Fill plan sections | 180 | Generator scaffolds; Verification/design still human |
| Plan gate confirm | 60 | After reading plan |
| Session approve | 45 | After reading status |
| Discover `--gate` | 30 | Multi-gate routes |
| Recover when `next` says complete | 45 | G1 |
| Read complete-check | 20 | |
| Accept | 30 | |
| Handoff | 15 | Not forced by next |
| Feature add / session goal | 30 / 20 | Partial re-entry of title/goal |
| Verify command choice | 15 | Often defaults to `npm test` |

## Results

| Route | Steady human governance (min) | Active human ops (excl. init amortize) | Repeat-entry ops | `next` complete after approve |
|-------|-------------------------------|----------------------------------------|------------------|-------------------------------|
| bugfix-quick | **7.67** | 10 | 4 | false (single gate path differs) |
| feature-standard | **8.17** | 11 | 4 | **true (G1)** |
| refactor-safe | **8.17** | 11 | 4 | **true (G1)** |

| Aggregate | Value |
|-----------|--------|
| **Median steady governance** | **8.17 min** |
| All routes ≤10 min (modeled) | **Yes** |
| Net benefit vs no-Amber proven | **No** |

CLI wall-clock for the full governance chain is on the order of **tens of seconds** per route (machine); it is dominated by human judgment, not CLI latency.

## Active human operations (typical feature-standard)

1. Feature id/title  
2. Fill plan sections (largest block)  
3. Plan gate confirm  
4. Session start goal/route  
5. Verify command intent  
6. Discover gate id (multi-gate)  
7. Session approve  
8. Recover terminal steps when next says done (G1)  
9. Read complete-check  
10. Accept  
11. Explicit handoff  

**Repeat entry (~4 ops):** feature title ↔ plan title ↔ session goal; plan Verification ↔ `session verify --command`; next does not eliminate dual-gate or terminal-step knowledge.

## Can generators / next / risk grading keep median ≤10 min?

| Mechanism | Helps? | Residual |
|-----------|--------|----------|
| `amber plan` scaffold | Yes — structure | Still ~3 min fill |
| `amber next` | Partial mid-path | **G1** drops complete/accept/handoff |
| `gate --confirm` / generators | Yes for plan field | No full plan validation at confirm |
| Route risk / gates | Forces intentional approve | Multi-gate needs `--gate`; friction |
| Handoff generator | Yes when run | Must remember to run |

**Median ≤10 min:** **plausible under this model** for ordinary tasks (≈8 min steady).  
**Net benefit positive:** **not proven** — requires baseline review/handoff timing without Amber (map bar −30%). Overhead can be ≤10 min and still be pure cost if review savings are smaller.

## Answer

- **Active human ops:** ~10–11 per ordinary task after install (plus dual approvals).  
- **Repeat entry:** ~4 ops restate goal/verification intent.  
- **Median governance overhead:** **~8.2 minutes** modeled → **meets ≤10 min bar as an estimate**, not a field study.  
- **Net benefit positive:** **unknown / unproven**; do not claim positive ROI from this ticket alone.

## Confidence

- **CLI timings:** high (measured).  
- **Human judgment totals:** medium (explicit model; not wall-clock HITL study).  
- **Net benefit:** low (no baseline).
