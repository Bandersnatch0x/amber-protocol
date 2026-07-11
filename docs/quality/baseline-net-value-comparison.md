# Research: Amber vs no-Amber baseline net value

**Ticket:** [比较 Amber 与无 Amber 基线的净增价值](https://github.com/Bandersnatch0x/amber-protocol/issues/32)  
**Map:** [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)  
**Depends on:** journey [#28](https://github.com/Bandersnatch0x/amber-protocol/issues/28), e2e [#29](https://github.com/Bandersnatch0x/amber-protocol/issues/29), overhead [#30](https://github.com/Bandersnatch0x/amber-protocol/issues/30)  
**Date:** 2026-07-10  

## Question

> 相较于 AGENTS.md、GitHub Issue/PR、CI、人工 Checklist 和 Agent 自带会话记录的组合，Amber 为目标团队独立增加了什么可测价值；哪些能力只是重新包装已有流程，哪些治理保证是基线难以稳定提供的？

## Baseline defined

| Baseline piece | Typical role |
|----------------|--------------|
| `AGENTS.md` / CLAUDE.md | Static agent instructions |
| GitHub Issue / PR | Task tracking, review discussion |
| CI | Automated verify on push/PR |
| Human checklist | Ad-hoc process memory |
| Agent session transcript | Ephemeral chat continuity |

Target team: 3–30 engineers, frequent coding agents, cross-session/person, human review required.

## Capability matrix

| Capability | Baseline can do? | Amber adds? | Classification | Measurable? |
|------------|------------------|-------------|----------------|-------------|
| Static agent rules | Yes (`AGENTS.md`) | Installs templates; does not unique them | **Re-wrap** | Low |
| Task discussion | Yes (Issues/PR) | Plan markdown + feature_list | **Partial re-wrap** (structured) | Medium |
| Automated tests | Yes (CI) | `session verify --execute` policy-gated + ledger | **Additive** (local session evidence, not only CI) | High (exit codes) |
| Ad-hoc process checklist | Yes | Routes + gates + complete-check checklist | **Partial re-wrap** with machine eval | Medium |
| Chat continuity | Yes (agent transcript) | `session-handoff.md` regenerator + session timeline | **Additive** if used | Medium |
| **Executed vs claim verification** | Unstable (people self-report) | `executed:true` + strict complete-check | **Hard-to-baseline** | High |
| **Tamper-evident verify/approve ledger** | Rare without custom tooling | session ledger hash chain | **Hard-to-baseline** | High |
| **Dual gate records** (plan confirm + session approve) | Possible via PR review only | Explicit plan field + timeline `gate_passed` | **Additive / harder in baseline** | High |
| **Accept blocked without evidence** | Policy culture only | Enforced in `accept` | **Hard-to-baseline** | High |
| **Policy default-deny on verify execute** | N/A or CI only | verify-rules allow-list | **Additive** | High |
| **Single `next` navigator** | No unified tool | `amber next` | **Additive but incomplete (G1)** | High |
| **Feature evidence reflux** | Manual notes | feature_list.evidence from verify | **Additive** | High |
| Web session viewer | Optional dashboards | Partial supervised viewer (ADR-0007) | **Additive partial** | Medium |
| Adoption audit reports | Manual | `adoption report` | **Additive for onboarding** | Medium |

## Independent measurable value (net, structural)

What Amber can measure that baseline usually cannot **stably**:

1. **Evidence grade:** claim vs executed verification distinguished; strict completion refuses claims.  
2. **Append-only session timeline + hash-chain ledger** for verify/approve events.  
3. **Machine-enforceable accept gate** requiring feature evidence.  
4. **Repo-local feature evidence list** bound to sessions.  
5. **Regenerable handoff** from live state (when command is run).  
6. **Governed local verify** without turning into arbitrary shell (default-deny).

## Re-wrap / weak uniqueness

1. Plan documents ≈ design docs / PR descriptions.  
2. Feature list ≈ issue tracker status (weaker multi-user UX than GitHub).  
3. Doctor/init scaffolding ≈ cookiecutter + CONTRIBUTING.  
4. `next` mid-path guidance ≈ a good runbook — **and currently incomplete** at the terminal steps (G1).  
5. Wiki skeleton ≈ docs already present in mature repos.

## Cost side (from #30)

- Modeled **~8 min** median human governance overhead per ordinary task (≤10 min bar as model).  
- ~4 **repeat-entry** frictions (title/goal/verification restated).  
- G1/G2 force extra human knowledge so “generators + next” do not fully collapse cost.

## Net value judgment (structural, not field-verified)

| Claim | Status |
|-------|--------|
| Amber has **some unique governance guarantees** hard for baseline to stabilize | **Yes** (evidence grade, ledger, accept gate, policy-deny verify) |
| Amber is **mostly** a re-wrap of Issue+CI+AGENTS | **No** — core guarantees are real, though surrounding docs/scaffolds re-wrap |
| Unique value is **field-proven** for target teams | **No** (#31: 0 external 2×10 evidence) |
| Net benefit (time saved − overhead) **positive** | **Unproven** |

## Answer

Amber’s **independent, measurable** additions are: executed-evidence semantics, tamper-evident session ledgers, dual gate artifacts, accept-without-evidence refusal, policy-gated local verify, and (when used) live handoff generation. Much of the install surface (AGENTS templates, wiki, plan files, feature list) **re-packages** baseline practices with better structure. Baseline is **unlikely to stably** provide claim-vs-executed distinction + hash-chain ledger + accept evidence gate without custom tooling. **Net value is structurally plausible but not verified** against field review/handoff savings.

## Confidence

- Structural comparison: **high** (grounded in code paths from #28/#29).  
- Field net benefit: **low** (no baseline pilot).
