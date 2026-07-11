# E2E: Amber governance loop on a fresh non-Amber target

**Ticket:** [在全新目标仓库验证 Amber 治理闭环](https://github.com/Bandersnatch0x/amber-protocol/issues/29)  
**Map:** [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)  
**Product:** `amber-protocol@1.3.1`  
**Runner:** `node scripts/demo/e2e-governance-loop-verify.js`  
**Machine log:** [`e2e-governance-loop-verify.json`](./e2e-governance-loop-verify.json)  
**When:** 2026-07-10 (win32, Node v24.2.0)  
**Constraint:** investigation only — product behavior not changed; temp targets only.

## Question answered

> 在一个全新、非 Amber 产品仓库中，成功路径、拒绝路径、验证失败恢复和跨会话 Handoff 能否形成可重复、可独立复核的闭环，并满足严格 Completion Check 与 Evidence 语义？

## Short answer

| Path | Result |
|------|--------|
| **Success path** | **Closes** when the operator follows the full command sequence (not only `amber next`). Feature ends `accepted` with executed evidence; live handoff carries `npm test` + session id. |
| **Rejection paths** | **Hold:** policy deny, claim-only vs `--strict`, accept without evidence, multi-gate approve without `--gate`. |
| **Verify-fail recovery** | **Works:** `verification_failed` then successful re-verify; strict complete-check can pass. |
| **Cross-session handoff** | **Works** after explicit `amber handoff`: useful handoff file, completed session not resurrected, second session starts. |
| **Strict Completion Check / Evidence purity** | **Partial:** executed evidence + accept gates are real; **G1/G2 reproduce** on a non-product repo (same as journey research). |

**Loop integrity for adjudication:** **partial closed loop** — command graph is repeatable and independently re-checkable for success/reject/recover/handoff, but navigation and handoff-evidence semantics are not fully closed.

## Method

Four isolated **git** temp repositories (not the Amber product tree):

1. `git init` + minimal `package.json` + README commit  
2. Drive Amber CLI from the product workspace: `node <product>/scripts/amber.js … --target <temp>`  
3. Record exit codes, `amber next --json`, complete-check output, feature_list evidence, handoff content, timeline events  

## Path A — Success

Sequence exercised:

`audit → next → init → plan → (fill plan sections) → gate --confirm → real work commit → session start --feature → session verify --execute --command "npm test" → session approve --gate user-approval-implement --yes → complete-check --strict → session complete → accept → handoff`

| Check | Observed |
|-------|----------|
| Feature status after accept | `accepted` |
| Evidence count | `1` (executed `npm test`) |
| accept / handoff exit | `0` / `0` |
| Live handoff contains evidence + session | yes |
| `next` after approve | `complete: true` (“All lifecycle steps complete for this focus”) |
| `next` recommends complete/accept/handoff after approve | **no** |
| `complete-check --strict` while handoff still init template | **pass** |

**Finding G1 (high):** navigational last-mile gap reproduces outside the product repo.  
**Finding G2 (high):** template handoff satisfies complete-check handoff presence.

## Path B — Rejections

| Case | Expected | Observed |
|------|----------|----------|
| `verify --execute --command "echo should-deny"` | policy deny | **denied**, non-zero exit |
| claim-only `verify` then `complete-check --strict` | fail verification | **fail** (missing executed verification) |
| `accept` on confirmed plan with **no** feature evidence | blocked | **blocked** (`AMBER_E_FEATURE_NO_EVIDENCE` / cannot accept) |
| `session approve --yes` without `--gate` on multi-gate route | refuse | **refuses**, asks for `--gate` |

Denial and Evidence gates are independently enforceable on a fresh target.

## Path C — Verify-fail recovery

1. `npm test` exits 1 → `session verify --execute` fails; stage **not** marked complete; timeline gets `verification_failed`.  
2. Fix tests, commit, re-run `verify --execute` → success (`stage_completed`, `executed: true`).  
3. Approve → `complete-check --strict` can pass.  
4. Session remains usable across the failure (no forced abort).

Recovery is **repeatable** and leaves an auditable failure+success trail.

## Path D — Cross-session handoff

1. Close session 1 through complete → accept → `handoff`.  
2. Handoff file is **not** the scaffold: contains `npm test`, next actions, feature state.  
3. `session continue` on completed s1 is **refused**.  
4. Session 2 starts on a new feature (`F2`) successfully.  
5. `complete-check --strict` can be re-run on completed s1 artifacts for independent review.

Cross-person continuity is achievable **if** someone runs `amber handoff` after completion; it is not forced by `next` or by complete-check.

## Strict Completion Check & Evidence semantics (synthesis)

| Rule | Enforced on fresh target? |
|------|---------------------------|
| Executed verification required for `--strict` | **Yes** |
| Claim-only does not satisfy `--strict` | **Yes** |
| Accept requires feature evidence | **Yes** |
| Policy default-deny on verify execute | **Yes** |
| Multi-gate approve needs explicit gate id | **Yes** |
| Handoff must be live/regenerated for complete-check | **No** (existence of template suffices) |
| Work evidence (git dirty/commits outside state dir) | **Yes** (non-git would soft-pass) |
| `next` guides full strict terminal sequence | **No** after approve |

## Comparison to journey research (#28)

| #28 claim | #29 fresh-repo result |
|-----------|------------------------|
| Commands can close the loop | **Confirmed** (`successClosed: true`) |
| G1 `next` last-mile | **Reproduced** |
| G2 template handoff | **Reproduced** |
| Dual gates / accept evidence | **Confirmed** on reject path |
| Demo-only optimism | Reduced: same result on **non-product, git** target, not only `acceptance-demo.sh` temp non-git |

## Implications for map adjudication (#34)

- Do **not** mark runtime loop as **完整**: G1 + G2 are product-behavior gaps on the target-team path, not demo artifacts.  
- Do **not** mark as **未闭环**: success, reject, recover, and handoff are command-repeatable with inspectable artifacts.  
- Best fit remains **部分闭环**, with higher confidence than #28 alone (fresh-repo e2e + machine log).  
- Value verification still requires external tasks/repos (#30–#33); this ticket only proves **operability** under controlled AFK conditions.

## Reproduce

```bash
# from amber-protocol product root
node scripts/demo/e2e-governance-loop-verify.js
# writes docs/quality/e2e-governance-loop-verify.json
```

## Primary artifacts

- `scripts/demo/e2e-governance-loop-verify.js` — AFK runner  
- `docs/quality/e2e-governance-loop-verify.json` — full machine log  
- Prior journey map: `docs/quality/user-journey-adoption-to-handoff.md`
