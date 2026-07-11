# Amber user journey: adoption → accept → handoff

**Ticket:** [映射 Amber 从采用到接受交接的真实用户旅程](https://github.com/Bandersnatch0x/amber-protocol/issues/28)  
**Map:** [验证 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/27)  
**Product version inspected:** `amber-protocol@1.3.1` (local workspace)  
**Method:** primary sources only — CLI implementation (`scripts/lib/core/lifecycle.js`, `completion-check.js`, `session-commands.js`, `planning.js`, `handoff-command.js`, `audit.js`), `scripts/demo/acceptance-demo.sh`, CLI help, ADR-0007, and a live temp-repo smoke of `amber next` through the main path.  
**Date:** 2026-07-10  
**Scope:** investigation only (no product code changes).

## Verdict (one line)

For the target team, the **documented / demo main path is executable end-to-end as commands**, but **navigation (`amber next`) and single sources of truth are only partial**: several mandatory terminal steps are invisible to `next`, dual gate layers are easy to confuse, and `complete-check` can treat install-template handoff as sufficient evidence.

## Canonical journeys

### A. Greenfield governed delivery (primary value path)

Source of truth for the *intended* 11-step path: `scripts/demo/acceptance-demo.sh` and `lifecycle.js` `STEPS`.

| # | Step | Command / action | Durable artifact (SOT) | Next-step connector |
|---|------|------------------|------------------------|---------------------|
| 1 | Inspect | `amber audit --target .` | stdout / JSON report only | `audit.nextSafeCommand` → always `init` (not full lifecycle) |
| 2 | Install | `amber init --target .` | starter files (`feature_list.json`, `session-handoff.md` template, wiki, …) | `amber next` → plan/feature if F001 seeded |
| 3 | Feature | `amber feature add` (optional if init seeded F001) | `feature_list.json` | `next` step `feature` when list empty |
| 4 | Plan | `amber plan --feature <id> --title "..."` | `docs/plans/<id>-*.md` | `next` step `plan` |
| 5 | Plan gate | `amber gate --confirm --plan <path>` | plan field `User Confirmation: confirmed` | `next` step `gate` |
| 6 | Session | `amber session start --goal "..." --feature <id>` | `.amber/sessions/<id>/manifest.json` + timeline | After gate, `next` remedy is `session start` (`feature-evidence`) |
| 7 | Verify | `amber session verify --session <id> [--execute --command ...]` | timeline `stage_completed` (+ ledger); **executed** evidence refluxes into `feature_list.json` | `next` step `verify` (session focus) |
| 8 | Session approve | `amber session approve --session <id> --gate <gate-id> [--yes]` | timeline `gate_passed` | `next` step `approve` |
| 9 | Completion check | `amber session complete-check --session <id> --strict` | evaluation over timeline/manifest/git/handoff path | Documented in CLI ref; **often not recommended by `next` once evidence already passes** |
| 10 | Session terminal | `amber session complete --session <id>` | manifest `status: completed` | **Not a `lifecycle.js` step** — must be known from docs/demo |
| 11 | Accept | `amber accept --plan <path> [--session <id>]` | `docs/wiki/engineering/harness-evolution.md` + feature `status: accepted` | `next` step `accept` **only after** no non-completed session remains |
| 12 | Handoff | `amber handoff` | regenerates `session-handoff.md` from live state | **Not a `lifecycle.js` step**; `handoff` output re-embeds next action |

Optional / adjacent (same delivery concern, not in `STEPS`):

| Step | Command | Role | Connector gap |
|------|---------|------|---------------|
| Doctor | `amber doctor` | readiness validation | Not on main `next` path; getting-started leads with it |
| Review | `amber review --plan` | standards + plan gate validation (read-only) | Not in `STEPS`; `accept` re-runs review logic internally |
| Wiki | `amber wiki` | context skeleton | Bootstrap/install adjacent |
| Route inspect | `amber route inspect` | understand gates for `session approve --gate` | User must discover gate ids |

### B. Existing-repo adoption (secondary path)

Commands exist and produce reports, but they are **not wired into `amber next`**:

`adoption report` → `list` / `index` / `validate` / `compare` → `gate` → `bundle` → `next-actions` / `decision-record` / `selected-files`.

This path answers “should we install Amber here?”; it does not automatically hand off into journey A. After a deliberate init, the user re-enters journey A via `next` / doctor.

### C. Web console (supervised viewer)

Per ADR-0007 (`docs/adr/0007-web-viewer-role.md`):

| Allowed in Web | Forbidden in Web (CLI-only intentionality) |
|----------------|--------------------------------------------|
| session start/pause/resume/abort | `gate --confirm` |
| `runVerification` (same as `session verify --execute`) | `session approve`, `session complete`, `accept`, `handoff`, feature management |

**Implication for the target team:** a full accept/handoff loop **cannot** stay in the browser; human gate + accept + handoff remain CLI (or equivalent intentional surfaces). The Web path is a partial loop by design, not an accidental gap.

## Single sources of truth (and splits)

| Concern | Intended SOT | Reality / split |
|---------|--------------|-----------------|
| Feature registry & evidence | `feature_list.json` | Evidence only refluxes from **executed** verify (or `feature verify`); claim-only verify does not |
| Plan confirmation | plan `User Confirmation` | Written by `gate --confirm`; **not** re-checked by `complete-check` |
| Session approval | timeline `gate_passed` | Required by `complete-check`; dual layer with plan gate (D1 from closed map #14) |
| Session progress | `.amber/sessions/<id>/` manifest + `timeline.jsonl` + `ledger.jsonl` | Strong local SOT when present |
| “What next?” | `amber next` → `lifecycle.js` | Incomplete relative to demo’s terminal steps |
| Cross-session handoff | `session-handoff.md` (regenerated) | Init installs a **template** that already satisfies existence checks |
| Long-term acceptance log | `docs/wiki/engineering/harness-evolution.md` | Written by `accept`; `next` detects accept via plan path substring match |
| Policy for verify execution | `.amber/governance` / verify rules (default deny) | Real execution is gated; claims are not |

## Gaps ranked by impact × friction

### G1 — `amber next` drops the last mile (high impact)

**Evidence (live smoke, temp harnessed repo, 2026-07-10):**

1. After `session approve`, auto-focus stays on the open session and `next` prints **“All lifecycle steps complete for this focus.”**
2. It does **not** recommend `session complete-check`, `session complete`, `accept`, or `handoff`.
3. Only after `session complete` (status → completed) does focus flip to the feature and recommend `accept`.
4. `session complete` and `handoff` are **absent** from `lifecycle.js` `STEPS` (only: init, feature, plan, gate, feature-evidence, verify, approve, complete-check, accept).

**Why it matters:** the target team’s success metric depends on complete evidence + handoff. Navigation that stops at “session has verify+approve” teaches a **partial** loop.

**Counter-evidence:** `acceptance-demo.sh` and CLI help still document the full 11-step path; an agent following the demo (not only `next`) can finish.

### G2 — `complete-check` treats template handoff as present (high impact for Evidence integrity)

`completion-check.js` marks handoff satisfied if:

- `manifest.handoff.path` is set, **or**
- `session-handoff.md` **exists** on disk.

`init` always creates `session-handoff.md` as a scaffold. Live smoke: **strict complete-check passed** while the file still said “scaffolded… Command: not run yet”. Regenerating handoff later is optional from `next`’s point of view.

**Why it matters:** Evidence complete rate can look green without a regenerated, state-true handoff — undermines the map’s 90% Evidence bar if measured only by complete-check.

### G3 — Dual gates + dual statuses invite re-entry / ambiguity (medium–high)

| Layer | Mechanism | Enforced by |
|-------|-----------|-------------|
| Plan | `User Confirmation` via `gate --confirm` | `review` / `accept` (`validatePlanContent`); `next` gate step |
| Session | `gate_passed` via `session approve --gate` | `complete-check`; `next` approve step |

Observed frictions:

- Route may require **explicit `--gate <id>`** when multiple gates exist; wrong id fails.
- `gate --confirm` does **not** run full plan body validation; incomplete Verification/sections can be confirmed and only fail later at `accept`.
- Plan `Status:` is scaffolded as `implementation-ready` while confirmation is still `pending` (label vs gate mismatch).
- Feature statuses move `not_started` → `passing` (on evidence) → `accepted` (on accept); session statuses are separate (`created`…`completed`). Easy to believe “passing” means “accepted”.

### G4 — Manual plan authoring is still required (medium)

`amber plan` scaffolds sections; feature-seeded verification bullets may be empty. Demo must fill Verification before accept. This is deliberate human work, but it is **repeat entry** of verification intent that also lives on the route verify stage / `session verify --command`.

`review` is the right preflight, yet `next` never points at it.

### G5 — Adoption and delivery are disconnected navigationally (medium for first-time teams)

Existing repos are told (getting-started) to use doctor / adoption report, while delivery navigation is `next`. No single command sequence from “adoption gate pass” → “first feature accept”. Risk of abandoned install or init without ever entering journey A.

### G6 — Web partial loop is intentional but easy to over-read as product completeness (medium for messaging)

Closing map #6 designed a Governance Console loop; ADR-0007 correctly keeps approve/complete/accept/handoff CLI-only. For issue #27’s dual judgment, **runtime loop completeness must be scored on CLI (or CLI+Web hybrid), not Web alone**.

### G7 — Claim vs executed verification (medium, partially fixed)

Claim-only `session verify` records `executed: false` and does **not** reflux to `feature_list.json`. Strict complete-check requires executed evidence. Default `amber next` completion evaluation uses **non-strict** completion (`buildContext` strict only if options.strict), so navigation can treat claim verification as enough for the `complete-check` *step* while `complete-check --strict` / `session complete` (strict by default) would still demand executed evidence depending on path.

### G8 — Docs surface fragmentation (low–medium)

- Getting-started organizes **service packages**, not the 11-step demo order.
- CLI reference lifecycle string: `init → feature → plan → gate → verify/approve → complete-check → accept` — omits `session complete` and `handoff`.
- Operating manual still lists `audit → init → plan → gate → verify → approve → handoff` (handoff present; session complete / accept ordering differs).

## What is *not* a break (counter-evidence to “unclosed”)

1. **Acceptance demo** implements audit→…→handoff and asserts lifecycle complete — proves the command graph can close under controlled conditions (`scripts/demo/acceptance-demo.sh`).
2. **Closed map #14** fixed many technical breaks (audit next, feature-bound session, verify reflux, handoff generator, accept evidence gate, session complete, next/complete-check strict alignment work).
3. **Policy default-deny** on executed verify prevents Amber from becoming an arbitrary shell runner.
4. **Handoff generator** now rebuilds from live state (`handoff-command.js`); when run, content matches features/evidence/next.
5. **Doctor** validates harness files, feature list, wiki, handoff structure — good readiness SOT for install quality.

## Journey integrity matrix

| Link | Executable command? | Single durable SOT? | Clear next step? | Notes |
|------|---------------------|---------------------|------------------|-------|
| audit → init | Yes | Report ephemeral | Partial (`nextSafeCommand`) | Audit not in `lifecycle` STEPS |
| init → feature/plan | Yes | Files on disk | Yes via `next` | Init may seed F001 |
| plan → gate | Yes | Plan markdown field | Yes | Confirm without full plan validation |
| gate → session | Yes | Session dir | Yes (remedy = start) | Focus switch feature→session |
| session → verify | Yes | Timeline/ledger | Yes | Prefer `--execute` for real evidence |
| verify → approve | Yes | Timeline | Yes | Tip in verify output; needs `--gate` often |
| approve → complete-check | Yes | Eval only | **Weak** | `next` may already say complete |
| complete-check → session complete | Yes | Manifest status | **Missing in `next`** | Required for focus to leave session |
| session complete → accept | Yes | Evolution log + feature status | Yes (after complete) | Accept re-validates plan body |
| accept → handoff | Yes | `session-handoff.md` | **Missing in `next`** | Complete-check may already be green on template |
| handoff → next work | Yes | Regenerated handoff + `next` | Yes when handoff run | Cross-person continuity depends on this file quality |
| adoption → delivery | Commands exist | Report files | **No unified next** | Separate product surface |
| Web → full accept | Partial | Same artifacts | Partial | Approve/accept/handoff CLI-only |

## Implications for map #27 (not a final adjudication)

These implications feed [裁决 Amber 的运行闭环与实际价值](https://github.com/Bandersnatch0x/amber-protocol/issues/34); they are **not** the dual verdict themselves.

- **Runtime loop:** evidence supports **partial closed loop** at product-navigation level: core commands and demo close; `next` + Evidence semantics leave terminal and integrity holes. (E2E ticket #29 should re-test on a non-Amber target repo and failure paths.)
- **Value:** journey mapping alone cannot mark value verified; it shows **reasonable structural value** (SOT artifacts, dual gates, ledger, handoff generator) with **unproven** time/cost gains and known friction (G1–G5). External evidence remains #31; overhead #30; baseline #32.

## Primary source index

| Source | Role |
|--------|------|
| `scripts/lib/core/lifecycle.js` | Declarative STEPS + focus resolution |
| `scripts/lib/next-command.js` | `amber next` envelope |
| `scripts/lib/completion-check.js` | Strict/relaxed completion + handoff/work checks |
| `scripts/lib/session-commands.js` | verify/approve/complete behavior, evidence reflux |
| `scripts/lib/core/planning.js` | plan scaffold, gate confirm, review, accept |
| `scripts/lib/handoff-command.js` | Live handoff regeneration |
| `scripts/lib/core/audit.js` | `buildNextSafeCommand` → init |
| `scripts/demo/acceptance-demo.sh` | 11-step success path |
| `docs/adr/0007-web-viewer-role.md` | Web/CLI intentional boundary |
| `docs/CLI_REFERENCE.md` (`next` section) | Documented lifecycle string |
| Live temp-repo smoke (this research) | Observed `next` / complete-check / handoff template behavior |

## Suggested inputs to later tickets (no implementation here)

- **#29:** Reproduce success, deny, verify-fail recovery, and cross-session handoff on a fresh non-product repo; assert whether G1/G2 reproduce.
- **#30:** Time human steps especially plan body fill, dual approve, discovering `session complete` when `next` says done.
- **#32:** Credit only capabilities baseline tools lack stably: executed-evidence reflux, ledger tamper-evidence, dual gate records, generated handoff with next remedy — discount pure wrappers of Issue/PR/CI.
- **#34:** Weight G1+G2 heavily for “部分闭环”; do not claim “价值已验证” from dogfood/demo alone.
)
