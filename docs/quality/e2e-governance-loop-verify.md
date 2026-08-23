# E2E: Amber governance loop on a fresh non-Amber target

**Ticket:** [在全新目标仓库验证 Amber 治理闭环](https://github.com/Bandersnatch0x/amber-protocol/issues/29)  
**Map:** [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)  
**Product:** `amber-protocol@1.3.1`  
**Standard command:** `npm run test:governance-loop`  
**Runner:** `node scripts/demo/e2e-governance-loop-verify.js`  
**Machine log (historical):** [`e2e-governance-loop-verify.json`](./e2e-governance-loop-verify.json)  
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
| **Strict Completion Check / Evidence purity** | **Yes:** executed evidence + accept gates are real; **G1/G2 closed** on non-product target (2026-07-14 dogfood ritual confirmed; see updated Path A). |

**Loop integrity for adjudication:** **partial closed loop** — command graph repeatable; as of 2026-07-14 dogfood on real target, navigation (G1) and handoff-evidence (G2) are closed for target path (internal product-repo special case no longer the only verification).

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
| `next` after approve | recommends "Regenerate session handoff" (then complete after) |
| `next` recommends complete/accept/handoff after approve | **yes** (via handoff step in STEPS + inferNextStep) |
| `complete-check --strict` while handoff still init template | **fail** (Missing: handoff) |
| `complete-check --strict` after live `handoff` | **pass** |

**Finding G1 (high):** navigational last-mile now guides on target (handoff step surfaced post-approve). Verified closed in real dogfood run 2026-07-14.  
**Finding G2 (high):** template handoff is rejected by complete-check --strict; only live handoff satisfies. Verified closed on target-repo.

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

| #28 claim | #29 fresh-repo result | #54 dogfood target result (2026-07-14) |
|-----------|------------------------|---------------------------------------|
| Commands can close the loop | **Confirmed** (`successClosed: true`) | **Confirmed** (full manual run) |
| G1 `next` last-mile | **Reproduced** | **Closed** (next guides to handoff post-approve) |
| G2 template handoff | **Reproduced** | **Closed** (strict rejects scaffold, passes only after live handoff) |
| Dual gates / accept evidence | **Confirmed** on reject path | **Confirmed** |
| Demo-only optimism | Reduced: same result on **non-product, git** target, not only `acceptance-demo.sh` temp non-git | Further reduced: manual lifecycle on fresh target matches product behavior for G1/G2. |

## Implications for map adjudication (#34)

- G1 + G2 **closed on target-repo** per 2026-07-14 dogfood ritual (issue #54): `amber next` surfaces handoff step; `complete-check --strict` enforces live handoff. Update prior "reproduces" claims.
- Do **not** mark as **未闭环**: success, reject, recover, and handoff are command-repeatable with inspectable artifacts. Full lifecycle (plan→...→handoff) exercised end-to-end on external git target.
- Best fit remains **部分闭环** (or stronger for governance loop), with higher confidence (real target + dogfood ritual, not only scripted pilot or product self-run).
- Value verification still requires external tasks/repos (#30–#33); this run proves **G1/G2 navigation+evidence integrity hold for target-team path**.

## Reproduce

```bash
# from amber-protocol product root — standard verification command (#127)
npm run test:governance-loop
# optional: node scripts/demo/e2e-governance-loop-verify.js --output /tmp/loop.json
# Exits non-zero on path regression. Does not write the product tree unless --output is set.

# Or run the canonical manual dogfood ritual on a fresh target (as in #54):
# 1. mkdir -p /tmp/target && cd /tmp/target && git init && ... (package.json with test)
# 2. (from product) node scripts/amber.js init --target /tmp/target
# 3. node scripts/amber.js feature add --target /tmp/target --id F054 ...
# 4. (real edit + commit), plan, gate, session start --feature, verify --execute, approve, next, complete-check --strict (pre/post handoff), ...
```

**2026-07-14 dogfood evidence (issue #54):** full lifecycle executed on `D:\code_space\amber-dogfood-target-54` (external, fresh git, Windows). SID: b4a14cbe-bb72-4e41-a12e-5209240d07d6. Confirmed (A).

Key commands + observations (from product root):
- `node scripts/amber.js init --target D:\code_space\amber-dogfood-target-54`
- `node scripts/amber.js feature add --target ... --id F054 --title "Verify G1/G2..."`
- real change + `git commit` (README + plan fill)  [work evidence]
- `node scripts/amber.js plan --target ... --feature F054 ...`
- `node scripts/amber.js gate --target ... --plan ... --confirm`
- `node scripts/amber.js session start --target ... --goal "..." --feature F054 --route feature-standard` → SID b4a14cbe-...
- post-start commit (to ensure during-session work)
- `node scripts/amber.js session verify --target ... --session $SID --execute --command "npm test"` → executed evidence reflux to F054 (status:passing)
- `node scripts/amber.js session approve ... --gate user-approval-plan --yes`
- `node scripts/amber.js session approve ... --gate user-approval-implement --yes`
  After approve: `next --session $SID` → "Next step: Regenerate session handoff"   <--- G1 guided, no premature complete
- `node scripts/amber.js session complete-check --target ... --session $SID --strict` → "status: fail ... Missing: handoff" (exit 1)  <--- G2 rejects scaffold
- `node scripts/amber.js handoff --target ...`  (live content written, no more scaffold markers)
- `node scripts/amber.js session complete-check --target ... --session $SID --strict` → "status: pass ... handoff present" (exit 0)
- `node scripts/amber.js session complete ...` → "Session already completed" (auto on final gate)
- `node scripts/amber.js accept --target ... --plan ... --session $SID` → feature status: accepted; evolution log written
- `node scripts/amber.js handoff bundle --target ... && handoff validate --target ...` → 0
- ledger: `session verify-ledger` → "Session ledger intact (3 records)"
- final `next --feature F054` → "All lifecycle steps complete for this focus."

This run exercised the exact sequence required by dogfood-weekly.md §4 and closed G1/G2 on a genuine target-repo (product self was not used as target). No code changes needed; docs updated for reality.

## Primary artifacts

- `scripts/demo/e2e-governance-loop-verify.js` — AFK runner  
- `docs/quality/e2e-governance-loop-verify.json` — full machine log  
- Prior journey map: `docs/quality/user-journey-adoption-to-handoff.md`
