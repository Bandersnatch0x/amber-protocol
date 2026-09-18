# Trusted Control Governance Contract (0044 · 0045 · 0046 · 0049 · 0051 · 0052 · 0054 · 0055 · 0056 · 0060)

**Spec ID:** `trusted-control-governance-contract`
**Status:** proposed
**Updated:** 2026-09-16
**Review:** not yet reviewed by the coordinator. This status records the authority lifecycle only — it is not acceptance, and runtime implementation has not started.
**Adoption authority:** Goal packet `.scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4` (user-approved objective); this spec consolidates the ten listed tickets' recorded rulings into canonical text. It is not a fabricated per-decision human ratification; residuals and unresolved facts are named inline.
**Provenance:** `issues/0044-trusted-control-boundary-map.md` (umbrella), `issues/0045-harness-v3-gap-ledger.md` (gap ledger), `issues/0046-positioning-vocabulary-revision.md`, `issues/0049-domain-neutral-core-adapter-seam.md`, `issues/0051-pdp-policy-model-approval-binding.md`, `issues/0052-capability-target-effect-constraint.md`, `issues/0054-outcome-verification-provenance.md`, `issues/0055-replay-r0-r1-drift-bundle.md`, `issues/0056-lifecycle-state-machine-event-taxonomy.md`, `issues/0060-compat-versioning-cli-layout-pr-sequence.md` (2026-09-15 rulings; this packet appends the D0 consolidation Log entries to each). Source facts verified at HEAD `0a9cbeab85898bd043e1ab9f7c89ea71193cbb78`.
**Depends on:** the three sibling canonical contracts — `docs/specs/trusted-control-run-contract.md` (0050; run/RunScope/freeze/binding/replay inputs), `docs/specs/trusted-control-evolution-contract.md` (0048/0057; evolution loop), `docs/specs/trusted-control-context-runtime-contract.md` (0047/0053/0058/0059; PEP coverage, context firewall, runtime/research adapters) — plus F050 (approval/staleness/assurance), F052 (runner registry), F056 (external effects), F061/ADR-0028 (ledger family factory), F062 (route stage verbs), F063 (seven-verb default surface), ADR-0001/0005/0012/0022/0025/0030.
**Implementation plan:** `docs/plans/trusted-control-governance.md` (proposed; current implementation status: **not yet delivered**).

> Canonical contract for the remaining trusted-control governance planes: the
> umbrella plane map (0044), the reconciled gap ledger (0045), positioning and
> vocabulary (0046), the domain-neutral Core/Adapter seam (0049), the PDP
> decision model and approval binding (0051), the capability target/effect/
> constraint model (0052), outcome/verification/provenance (0054), replay
> R0/R1/drift/bundle (0055), the lifecycle state machine and event taxonomy
> (0056), and compatibility/versioning/CLI/layout/PR sequence (0060). Every
> decision extends an existing surface; nothing here creates a second PDP, a
> second state machine, a second ledger implementation, a second proposal
> authority, or a new default CLI verb. Where the V3.1 FINAL source is missing
> (`SOURCE-V31`), traceability is marked unresolved — never inferred from v2.

## 1. Problem and scope

0044's destination demanded one decision set covering every v3.1 plane. Three
packets already converted their planes into canonical contracts: A0 (run,
0050), B0 (evolution, 0048/0057), C0/C0R (context-runtime, 0047/0053/0058/
0059). This contract consolidates the remaining ten tickets' decisions into the
fourth canonical contract, with two duties beyond restating the tickets:

1. **Reconciliation duty:** where a 2026-09-15 ticket ruling was later
   superseded or sharpened by a sibling canonical contract (notably 0051's
   approval-binding fields vs the run contract §6), this contract adopts the
   sibling's canonical shape and records the delta explicitly (§6.4).
2. **Honesty duty:** decision coverage and implementation coverage are stated
   separately. All ten tickets are decision-covered here; **no runtime
   implementation of this contract has started** (the plans' slices are
   unchecked), and no whole-v3.1 compliance claim is made while `SOURCE-V31`
   (V3.1 FINAL source absent, goal packet `requirements.json` evidence gap)
   remains open.

## 2. Umbrella plane coverage (0044)

Every plane 0044 required maps to exactly one owning canonical contract. "D0"
means this contract; A0/B0/C0 mean the sibling contracts named in §1.

| Plane | Owning contract | Section | Status |
| --- | --- | --- | --- |
| run (identity, attempt, admission) | A0 run contract | §2/§3/§5 | proposed, not implemented |
| RunScope / frozen inputs / hashes | A0 run contract | §3/§4 | proposed, not implemented |
| replay (inputs, R0/R1, drift, bundle) | A0 §9 (inputs) + **D0 §9** (R0/R1/drift/bundle) | — | proposed, not implemented |
| lifecycle (state machine, events, timeline) | **D0 §10** (0056) | — | proposed, not implemented |
| policy (PDP, rules, approval binding) | **D0 §6** (0051) | — | proposed, not implemented |
| capability (target/effect/constraint/risk/budget) | **D0 §7** (0052) | — | proposed, not implemented |
| outcome (status/verification/side effects) | **D0 §8** (0054) | — | proposed, not implemented |
| provenance (levels, evidence classes) | **D0 §8** (levels) + C0 §2 (evidence classes) | — | proposed, not implemented |
| versioning / CLI / layout / PR sequence | **D0 §11** (0060) | — | proposed, not implemented |
| evolution (attribution, proposals) | B0 evolution contract | all | proposed; slice 1 delivered (B1/B1R) |
| context-runtime (PEP, firewall, adapters) | C0 context-runtime contract | all | proposed, not implemented |
| interception boundary (ADR-0001) | C0 §2 (blind-spot contract; ADR-0001 amended by that packet) | — | amended, not implemented |
| positioning / vocabulary (ADR-0030) | **D0 §4** (0046; ADR-0030 amendment appended by this packet) | — | amended |

Rules:

- **R-UM-1** No plane has two owners. Where a plane spans contracts (replay,
  provenance), the split is by concern: the run contract owns frozen replay
  **inputs**; D0 §9 owns the R0 bundle, R1 re-evaluation, and drift taxonomy.
  The evidence-class ceilings (E1–E4) are owned by C0 §2 and are cited, never
  restated, here.
- **R-UM-2** Decision coverage ≠ implementation coverage. As of this contract:
  implementation delivered = B0 slice 1 (attribution module + two consumers,
  `results/B1R-gates.log`); everything else in all four contracts is proposed
  with unchecked slices.
- **R-UM-3** No whole-v3.1 compliance claim. `SOURCE-V31` is unresolved: the
  V3.1 FINAL text is absent from `.scratch/harness-v2/` and bounded search
  (goal packet `requirements.json` `evidenceGaps[0]`). S1–S11 wording is
  therefore never quoted, mapped, or claimed by any of the four contracts
  (run §11, evolution —, context-runtime §9, and this §11.7 all state it).
- **R-UM-4** 0044's fog items (Ops adapter, multi-tenant isolation,
  attestation infrastructure, concurrency/idempotency beyond §7.3, web
  projections, metrics views, scheduled proposal generation) stay
  **intentionally out of scope**, each with its recorded precondition
  (0044 "Not yet specified" / "Out of scope"); none is silently absorbed here.

## 3. Gap-ledger reconciliation (0045)

0045's recorded conclusions (8 missing, 7 partial, 5 covered, 2 vocabulary
clashes) are reconciled against the repository at HEAD `0a9cbeab`. Each row
cites current evidence or is marked unresolved. "Covered" means the current
code already implements it; "owned" means a canonical contract + plan now
exists but implementation has not started.

| 0045 conclusion | Reconciliation at HEAD | Verdict | Evidence |
| --- | --- | --- | --- |
| Event + hash chain: governance ledger chained, session timeline not | Unchanged in code; owned by D0 §10.4 (run-events family, legacy prefix) | owned, not implemented | `scripts/lib/core/registry-ledger.js:47` (`chainHash`); `schemas/timeline-event.schema.json:8-27` (18 kinds, no `prevHash`/`hash` fields) |
| Approval single-use/expiry/revocation covered; scope binding missing | Covered for lifecycle; binding owned by run contract §6 (`scopeHash`/`policyVersion`/`capabilityHash`/`boundAttemptId`) + D0 §6.3 | covered + owned binding | `scripts/lib/core/approval-registry.js:15-32` (window/consume discipline), `:655` (`grantApproval`), `:1031` (`decisionScopeOf`) |
| Capability ≠ Credential ≠ Effect partial (six kinds, no target/constraints/idempotency) | Six-kind closed set confirmed; extensions owned by D0 §7 | owned | `scripts/lib/core/runner-registry.js:36-44` (`EFFECT_KINDS`), `:44` (`CREDENTIAL_REQUIREMENTS`) |
| PDP only allow/deny on command text | Confirmed; five-value enumeration owned by D0 §6.1 | owned | `scripts/lib/core/loop-policy.js:67` (`evaluateCommandPolicy`, deny-wins), `:20` (`defaultAction: "deny"`) |
| PEP coverage missing (host tool calls unmediated) | Resolved as **declared blind spot** by C0 §2 (evidence classes E1–E4; ADR-0001 amended) — a contract decision, deliberately not interception | covered by decision | `docs/specs/trusted-control-context-runtime-contract.md` §2; `docs/adr/0001-governance-first-artifact-first.md` (amendment) |
| Outcome single-dimension at receipt layer | Confirmed (`status` from exitCode only); multi-dimension owned by D0 §8 | owned | `scripts/lib/core/governed-runner.js:390` (`status: execution.exitCode === 0 ? "pass" : "fail"`) |
| Unified runId missing | Confirmed at the session surface; owned by run contract §2 (`run-{sessionId}-{attemptId}` derivation) | owned | `scripts/lib/core/governed-runner.js:273` (`glx-` is a worktree name only) |
| RunScope / snapshot hashes missing | Owned by run contract §3/§4 (five base hashes + `contractHash` + `inputDigest`) | owned | `scripts/lib/session-stage-runner.js:481` (`inputDigest` declared, `null` today) |
| Provenance four levels covered (renamed) | Confirmed: assurance `unavailable/observed/replayable/verified` | covered | `scripts/lib/core/evidence-receipts.js:54` (`ASSURANCE_LEVELS`), `:61` (`RECORDABLE_ASSURANCE`) |
| Replay R0/R1/drift missing | Owned by D0 §9 | owned | `scripts/lib/core/evidence-receipts.js:288` (`replayOfProblem`); `scripts/lib/core/handoff-bundle.js:201-219` (seven-file default bundle) |
| Declared vs Effective vs Observed missing | Owned by C0 §2.3 (D1 claim-check / D2 observed violation) | owned | `scripts/lib/core/dirty-paths.js:65`; `runner-registry.js:1909-1923` (scope claim check) |
| Context Firewall / snapshot / egress missing | Owned by C0 §3 (Loadout-as-snapshot; declaration-based egress) | owned | `docs/specs/trusted-control-context-runtime-contract.md` §3 |
| Identity/Actor covered (vocabulary clash) | Clash resolved by D0 §4.2 (Actor ≡ Principal, no rename) | covered | `scripts/lib/core/identity.js`; `CONTEXT.md` Principal entry |
| Intent vocabulary clash | Resolved by D0 §4.2 (action-level keeps `runner request`) | covered by decision | `CONTEXT.md:107-108` (Intent = governance artifact) |
| Admission/AUTHORIZED partial | Owned: run contract §5 (capture ≠ admission) + F052 `REQUEST_STATUSES` | owned | `scripts/lib/core/runner-registry.js:733` (`requested/authorized/denied`) |
| Budget / no-progress covered | Confirmed; run-level budget extension owned by D0 §7.4 | covered + owned extension | `schemas/loop-contract.schema.json` (`budget.maxMinutes/maxTokens/maxUsd`, `noProgressDetection`) |
| Evolution loop partial | Owned by B0 (attribution/validity/rejection records); slice 1 delivered | partially implemented | `scripts/lib/core/finding-attribution.js` (new, B1); `docs/plans/trusted-control-evolution.md` slice 1 progress note |
| State machine partial | Confirmed seven states; BLOCKED increment owned by D0 §10.1 | owned | `scripts/lib/session-state-machine.js:3-23` |
| Domain-neutral Core missing (22 git-coupled files) | Owned by D0 §5 (logical grouping + dependency guard; disposition list) | owned | §5.5 table (membership reconstructed and evidenced) |
| Domain Adapter contract missing | Owned by D0 §5.3 (`ExecutionDomainAdapter`) | owned | `scripts/lib/core/adapter-registry.js` (F051 read-only migration adapter — different contract, kept distinct) |
| Immutable snapshot primitives present but unused for run freezing | Confirmed; consumption owned by run contract §3 | covered primitives + owned use | `scripts/lib/core/context-hash.js` (`canonicalJson`, `sha256Hex`), `scripts/lib/core/ledger-seal.js` |

Verdict summary: **0 rows changed verdict without evidence; 0 rows silently
dropped.** The two 0045 vocabulary clashes are resolved (§4.2). One 0045
figure is corrected with evidence: the "22 core files depend on git/worktree"
count's membership was never recorded; §5.5 reconstructs it deterministically
(21 files matching `worktree|git-exec|git-state` in `scripts/lib/core/` plus
`git-exec.js` itself = 22) and adds the direct requirers the original grep
missed (`scaffold.js`; lib-level consumers) — a bookkeeping correction, not a
scope change.

## 4. Positioning and vocabulary (0046)

### 4.1 Positioning (ADR-0030 amendment)

ADR-0030 is **amended, not superseded**. The amendment appended by this packet
to `docs/adr/0030-coding-agent-enabled-repositories-and-trusted-continuation.md`
(`## Amendment (0046, 2026-09-16)`) lifts the positioning one level while
preserving the 2026-09-04 decision text verbatim: Trusted Continuation remains
the coding-domain core outcome; Amber's positioning is now **the trusted
control boundary between an agent and the real system**. The approved
positioning sentence (0046 §2, bilingual) is reproduced in the amendment.
Target users: Repository Maintainer stays primary; operator, researcher, and
platform team are secondary audiences for vocabulary coverage only — no new
default product promise (ADR-0030's expert-surface clause unchanged).

### 4.2 Vocabulary ruling table

| v3.1 term | Existing term | Ruling | Reason |
| --- | --- | --- | --- |
| Actor | Principal | **keep Principal** | v3.1 Actor ≡ Principal (`identity.js` Person/Agent, Tenant-scoped; `CONTEXT.md` Principal). A rename creates a synonym with no capability gain. v3.1 occurrences read as Principal. |
| Intent (action-level request) | Intent (governance artifact → Spec → Plan) | **action-level keeps `runner request`**; no new "Capability Request" term | `CONTEXT.md:107` Intent is the governance artifact; the action-level notion is already covered by `Stage Verb`, `Bounded Host Action`, `Execution Boundary`, `Runtime Operation`, and the runner request vocabulary (`requestHash`, capability). v3.1 action-level Intent reads as runner request. |
| Provenance (CLAIMED/OBSERVED/ATTESTED/VERIFIED) | Assurance (unavailable/observed/replayable/verified) | **no rename; document mapping only** (§8.3); ATTESTED is a reserved enum value | Assurance is a closed four-level contract (`evidence-receipts.js:54`); a `provenanceTier` field would duplicate one fact under two names. ATTESTED joins `ASSURANCE_LEVELS` but not `RECORDABLE_ASSURANCE` (implementation owned by D0 §8.3). |
| Harness | (none) | **new vocabulary entry: an architecture role name** | Harness names the layer responsibility (policy, capability, context, evidence, replay, run) realized by Amber Core plus governed adapters — not a product component, not the installer (`Amber Setup`), not a framework/platform. Avoid-list: agent framework, execution platform, runtime engine. |

### 4.3 Layering vocabularies (three sets, no renaming)

**A. v3.1 seven layers E/T/C/L/O/V/G ↔ the seven Control Layers** — one-to-one,
no conflict: E↔Execution, T↔Tooling, C↔Context, L↔Lifecycle, O↔Observability,
V↔Validation(Verification), G↔Governance. Governance-highest priority is
preserved in both.

**B. v3.1 four planes ↔ the seven layers** — orthogonal grouping, not a
replacement: Control = G(+PDP face); Execution = E+T+L; Evidence = O(+provenance/
replay); Verification = V(+gate/assurance). The Control Layers remain the
document positioning frame; the four planes remain an analysis frame. No
CONTEXT.md rewrite to four planes.

**C. Priority order** — Governance highest is retained (Control Layers first
rule; v3.1 G-highest; Control plane leads). The four planes have no linear
priority among themselves (parallel loop), and none is imposed.

### 4.4 Top-level verb principle

> Generic primitives first, domain commands second: Amber's public Core API
> exposes a small closed set of generic primitive verbs (a closed subset of
> govern/verify/observe/context/execute/replay/evolve); domain commands (route
> stage verbs, bounded host actions, external effects) are declarative
> compositions over the primitives, admitted through governed seams, never
> bypassing Gate/Approval/Policy/Evidence.

Consequence for the CLI surface: the F063 **seven-verb default surface
(`audit, init, doctor, next, plan, handoff, session` — verified at
`scripts/lib/command-help.js` default help output) is not expanded by this
contract**. Any future domain command enters as a declarative composition
registered outside the default projection (§11.3), which requires its own
0060-class ruling. **New default verbs added by this contract: 0.**

## 5. Domain-neutral Core / Adapter seam (0049)

### 5.1 Coexistence principle

> `.amber/` local state storage is a Core property (repository-local,
> offline-capable — ADR-0001/0019 unchanged); git semantics (worktree
> create/remove, diff, commit, config, log) are demoted to the Coding Domain
> Adapter — Core obtains them through the Adapter interface and never imports
> `git-exec` / `git-state` / `git-workflow-detector` / `worktree-manager`
> directly.

"Repository-local" names the **storage location** of Core state, not an
understanding of git semantics. Ledger/receipt/manifest persistence (fs layer)
stays Core; "isolate one execution in a worktree" is Coding-domain execution
semantics injected via the Adapter.

### 5.2 Layering decision

**Logical grouping + dependency-guard tests now; physical relocation to
`src/protocol|core|adapters|domains` deferred until a second (non-Coding)
domain consumer is running.** Rationale: ADR-0005 (no facade; direct imports)
— a `src/` move reintroduces an indirection layer; ADR-0025 (do not split too
early) — relocation before a second consumer is speculative generality. The
second-consumer precondition is a **running** Research adapter (C0 §6.4):
closing ticket 0058 authorized no moves, and no `src/` change may cite 0058
as satisfied.

### 5.3 Adapter contract (v3.1 §26 five methods) and F051 relationship

The five methods are a **new `ExecutionDomainAdapter` contract**; they do not
fold into F051's `adapter-registry.js`, which is a read-only **migration**
adapter (register/readReceipt/shadowCompare/cutover) with different semantics.
Both share the `ledger-family` factory base (ADR-0028) and nothing else.

| Method | Semantics | Delegates to (existing) |
| --- | --- | --- |
| `capabilities()` | declare available capabilities | `runner-registry.js` (EFFECT_KINDS, registration) |
| `contexts()` | declare accessible context | `context-loadout.js` (Loadout) |
| `executions()` | declare execution boundaries | `governed-runner.js` (via the Adapter interface) |
| `verifiers()` | declare verifiers | `evidence-receipts.js` verify + `gate-evaluation.js` |
| `validate()` | validate a run's legality | governed-runner four gates + `execution-validator.js` |

### 5.4 ExecutionBoundary mapping

| Boundary method | Existing implementation | Mapping |
| --- | --- | --- |
| `prepare` | `createWorktree` (`governed-runner.js:274`) + four-gate pre-check | Adapter.prepare delegates |
| `execute` | `spawnSync` (`:279`) | Adapter.execute delegates |
| `observe` | `recordExecutionEvidence` (`:364`) + dirty-path classify | Adapter.observe delegates |
| `checkpoint` | session manifest `worktree` + `completedStages` | Adapter.checkpoint writes the manifest |
| `interrupt` | `removeWorktree` (`:336`) + ledger abort | Adapter.interrupt delegates |
| `cleanup` | `removeWorktree` (`:336`) | Adapter.cleanup delegates |

CodingWorktree is the first implementation; sandbox/remote implementations
arrive only through the 0059 Runtime Adapter direction (C0 §5) — Amber never
owns a sandbox.

### 5.5 Git-coupled file disposition list

The 0045 ledger recorded "22 core files depend on git/worktree" without
recording membership. At HEAD the deterministic reconstruction is: the 21
files in `scripts/lib/core/` matching `worktree|git-exec|git-state` plus
`git-exec.js` itself = **22**; `scaffold.js` (requires
`git-workflow-detector`, missed by that pattern) and the lib-level consumers
are appended with evidence. Dispositions per 0049:

| # | File (all under `scripts/lib/` unless noted) | Evidence at HEAD | Disposition |
| --- | --- | --- | --- |
| 1 | `core/git-exec.js` | git command primitive | **Coding Adapter implementation** |
| 2 | `core/git-state.js` | requires git-exec + detector | **Coding Adapter implementation** |
| 3 | `core/git-workflow-detector.js` | requires git-exec | **Coding Adapter implementation** |
| 4 | `core/artifact-drift.js` | requires git-exec + detector | **Coding Adapter implementation** |
| 5 | `core/identity.js` | requires git-exec (configGet) | **Split**: Principal resolution Core; git-config source → Adapter |
| 6 | `core/ledger-seal.js` | requires git-exec (gitOutput/gitRun) | **Coding Adapter implementation** |
| 7 | `core/scaffold.js` | requires git-workflow-detector | **Split**: scaffold logic Core; detectGitWorkflow → Adapter |
| 8 | `core/sync-session.js` | requires git-exec | **Coding Adapter implementation** |
| 9 | `core/sync-transport.js` | requires git-exec | **Coding Adapter implementation** |
| 10 | `core/team-governance-advisor.js` | requires git-exec | **Coding Adapter implementation** |
| 11 | `core/governed-runner.js` | requires worktree-manager | **Split**: four gates Core; worktree/spawnSync → Adapter |
| 12 | `core/evidence-runner.js` | `spawnSync` generic executor (`:10`, `:86`) — not git | **Core keep** (command injected via Adapter) |
| 13 | `core/dirty-paths.js` | pure path classifier (comment-only git mentions) | **Core keep** |
| 14 | `core/execution-validator.js` | `.git/index` mtime heuristic (`:402`) + worktree-clean metadata check | **Core keep**; the `.git`-reading heuristic extracts to the Adapter seam during migration |
| 15 | `core/sync-project.js` | requires artifact-drift (indirect) | **Core keep** (indirect; follows artifact-drift's move) |
| 16 | `core/cli-output.js` | `--worktree` flag spec only (`:112`) | **Core keep** (no git semantics) |
| 17 | `core/fs-utils.js` | `.claude/worktrees` path guard only (`:249`) | **Core keep** |
| 18 | `core/governance.js` | ADR-0003 prose + ledger `worktree` field display (`:64`, `:275`) | **Core keep** |
| 19 | `core/governance-readiness.js` | `pack-missing-worktree-isolation` gate id (`:296`) | **Core keep** |
| 20 | `core/governance-report.js` | same gate id reference (`:63`) | **Core keep** |
| 21 | `core/loop-execution.js` | worktree prose in comments (`:5`, `:87`) | **Core keep** |
| 22 | `core/task-execution.js` | worktree path plumbing into replay/ledger text (`:23-29`, `:113`) | **Core keep** |
| 23 | `core/terminology.js` | replay prose only (`:45`) | **Core keep** |
| 24 | `core/workflow-packs.js` | worktree-isolation requirement text (`:262`) | **Core keep** |
| 25 | `worktree-manager.js` (lib level) | git-exec consumer | **Coding Adapter implementation** |
| 26 | `session-commands.js` (lib level) | requires worktree-manager (`:16`) | consumes via Adapter after the split |
| 27 | `completion-check.js` (lib level) | requires git-exec (`:8`) | consumes via Adapter after the split |
| 28 | `handoff-command.js` (lib level) | requires git-state (`:12`) | consumes via Adapter after the split |
| 29 | `status-command.js` (lib level) | requires git-state (`:13`) | consumes via Adapter after the split |

The exact membership of the original "22" beyond the reconstruction above is
**unresolved bookkeeping** (the original grep command was not recorded); rows
25–29 are lib-level consumers 0049 already accounted for. No scope decision
depends on the count.

**Safe migration order** (each step lands green; guards run from step 1):

1. Land the dependency-guard tests (§5.6) with the current allowlist (they
   pass today against the *declared* Core set — files not yet split are
   listed as known-deviation, so the guard is red only on new violations).
2. Extract the three pure Adapter implementations with no Core dependents in
   the critical path first: `ledger-seal`, `artifact-drift`,
   `team-governance-advisor` (their consumers already go through function
   seams).
3. Move `sync-session` / `sync-transport` (sync surface is self-contained).
4. Split `identity` (Principal resolution keeps the Core module name; git
   config reading becomes an Adapter module injected at the seam).
5. Split `scaffold` (detectGitWorkflow injected).
6. Split `governed-runner` (four gates Core; worktree/spawnSync via the
   ExecutionBoundary Adapter) — largest blast radius, lands last among
   splits, with the F062/F052 suites as the acceptance net.
7. Introduce `execution-domain-adapter.js` (§5.3) as the single seam the
   above hang from; update guards from known-deviation to strict.

### 5.6 Dependency-guard test specifications (not implemented here)

Target file `tests/unit/core-domain-separation.test.js` (0060 PR sequence
slice G-1):

- **Guard 1 (Core purity):** files under `scripts/lib/core/` marked Core must
  not `require` `./git-exec`, `./git-state`, `./git-workflow-detector`, or
  `../worktree-manager`.
- **Guard 2 (Adapter isolation):** files marked Coding Adapter may import git
  semantics but must not be directly required by a Core-marked file —
  injection through the Adapter interface only.
- **Guard 3 (whitelist):** `git-exec.js`, `git-state.js`,
  `git-workflow-detector.js`, `worktree-manager.js` are themselves Coding
  Adapter implementations and are outside Guard 1's Core set.
- Mechanics: AST scan of require paths (reusing `code-graph.js`'s AST
  capability), no runtime execution; a `core-layer.json` marker file (or
  header-comment convention, implementation choice in the plan) declares each
  file's layer.

## 6. PDP / policy model (0051)

### 6.1 Decision enumeration — extend, never duplicate

**The existing `evaluateCommandPolicy` (`loop-policy.js:67`, pure, deny-wins)
is the only PDP.** Its decision vocabulary extends from allow/deny to the
closed five-value set; no second PDP is created.

| Decision | Existing path | Mapping |
| --- | --- | --- |
| `deny` | deny-wins branch (`:70-78`) | direct |
| `allow` | allow branch (`:79-88`) | direct |
| `require_approval` | none (the approval **gate** is a separate governed-runner gate, not a PDP decision) | new value: a v2 rule with `decision:"require_approval"` makes the PDP return it; the caller then enters the approval flow (run contract §5 R-AD-6 capture→grant→execute) |
| `allow_with_limits` | none | new value: limits land in RunScope constraints (run contract §3); the PDP returns the decision plus the limits snapshot; the runner enforces |
| `unknown` | none (default deny) | new value: with `defaultAction:"unknown"`, an unmatched request returns unknown; the caller treats it as deny but records `reason:"no-rule-matched"`. unknown ⊃ deny (both fail closed; unknown additionally names the cause) |
| `defer` | — | **not introduced**: async PDP semantics contradict ADR-0001's synchronous artifact-first boundary; REQUIRE_APPROVAL is the human-delay path |

`confidence_gating` (ADR-0011) is orthogonal and unchanged: one rule may carry
both `decision` and `confidence`.

### 6.2 Rule schema (v2, draft)

`schemas/loop-policy.schema.json` (new file, 0060 PR): `schemaVersion: 2`
files may carry both v1 command-text rules and v2 capability rules;
`schemaVersion: 1` files keep working untouched. **No forced v1→v2
migration.** deny-wins across versions and across both rule families.

```json
{
  "schemaVersion": 2,
  "defaultAction": "deny",
  "rules": [
    {
      "id": "allow-read-feature-path",
      "decision": "allow",
      "match": {
        "capability": "filesystem.read",
        "target": { "pathPrefix": "src/" },
        "effect": "read",
        "constraints": { "maxBytes": 1048576 }
      }
    },
    {
      "id": "require-approval-deploy",
      "decision": "require_approval",
      "match": {
        "capability": "bounded-command.deploy",
        "effect": "deploy",
        "constraints": { "approvalTier": "human" }
      }
    }
  ]
}
```

Precision order (v3.1 §8 + F050): explicit deny (v1+v2, including the
un-removable builtin `deny-destructive`, `loop-policy.js:20-29`) >
require_approval > explicit allow > default. The organization-level ceiling
only tightens: an org capability-deny is never overridden by a repo-level
allow (F050 `mergeRules` "global deny + context rules append" semantics,
inherited by v2). The v2 capability face consumes the context ceiling
constraint (`maxClassification`) exactly as required by C0 §3.3.

### 6.3 Approval binding fields and expiry/invalidation

**Canonical shape (run contract §6, adopted here):** a grant binds
`{scopeHash, policyVersion (=policyHash), capabilityHash}` plus
`boundAttemptId` by default. The 0051 ticket's third field
`capabilityConstraints` (a capability × target × effect × constraints
snapshot) is **subsumed**: `scopeHash` freezes capabilities/targets/
constraints (scopeInputs) and `capabilityHash` freezes the registered
capability records — a separate constraints snapshot would duplicate both
under a second name. Recorded as a reconciliation delta, not a new decision.

Consumption eligibility order (each refusal explicit and pre-effect, run
contract R-AU-3): single-use → scopeHash → policyVersion → capabilityHash →
boundAttemptId. Expiry and revocation semantics stay with the approval
registry (`granted/revoked/consumed/expired` fold, `approval-registry.js:15-32`).

Invalidation on policy change **reuses F050 staleness propagation**: a rules
change writes a staleness receipt `{subject: affected approval id,
dependency: {type:"policy", identity: rules.json path, contentHash:
oldPolicyHash}, reason: "policy-version-changed"}`; consumption checks
staleness and refuses stale grants. No second invalidation mechanism. Revival
after drift is a new human authorization bound to the new frozen tuple (run
contract R-AU-4) — a verification event never revives a stale grant.

### 6.4 Loop-surface identity (run contract §8.1 dependency, resolved here)

The loop surface has no attempt identity today (`loop-execution.js:90-95`
passes `subject: {contractId}` only). Ruling: the loop `approved` record gains
the same three-hash tuple; **loop executions do not gain a separate
`loopRunId`** — the contract-scope `contractId` plus the consumed
`approvalKey` remains the loop execution identity, because loop runs are
single-execution contracts (one approval ⇒ one run, ADR-0003), making an
attempt layer redundant. R-AU-3(5)/R-AU-4 hold via the tuple binding.

### 6.5 `policy.evaluated` ledger event

The governed-runner ledger gains `kind:"policy.evaluated"` with fields
`{kind, runId, decision, matchedRule, reason, policyHash, scopeHash,
confidence, prevHash, hash}` — appended through the existing
`recordGovernedExecution` subject-extension pattern (`governed-runner.js:397`
area), no new ledger family (0045 conclusion; ADR-0028 factory only). Under
run contract R-AD-3/R-AD-4 the recorded `policyHash` equals the attempt's
frozen value by construction; a mismatch is itself a tamper signal.

## 7. Capability target/effect/constraint model (0052)

### 7.1 Effect classification — closed registry vocabulary, documented mapping

The F052 six-kind closed set (`EFFECT_KINDS`, `runner-registry.js:36-44`:
read/prepare/diagnose/write-target/deploy/rollback) **stays the registry
vocabulary**. The v3.1 eleven-way taxonomy is a documentation mapping, not a
second enum and not a replacement:

| v3.1 effect | Carrier | Mapping |
| --- | --- | --- |
| READ | `read` | direct |
| COMPUTE | `diagnose` (side-effect-free computation) | near |
| CREATE / UPDATE / DELETE | `write-target` | three-into-one |
| EXECUTE | stage-verb `bounded-command` face (F062) + governed-runner command | command face, not a capability effect |
| SEND / PUBLISH | F056 external | external face |
| TRANSFER | F056 external | external face |
| GRANT | credential-use: `CREDENTIAL_REQUIREMENTS` scoped (`:44`) + F056 credentials class | credential face |
| DEPLOY | `deploy` | direct |
| — (no v3.1 counterpart) | `rollback` | Amber-specific compensation declaration, kept |

Rationale: `EFFECT_RISK` (`:776-783`) and `ENVIRONMENT_PROFILES` derive from
the six kinds; an eleven-kind swap forces `RISK_POLICY_VERSION` bump plus
full capability re-registration (each a human-approved governance change) for
taxonomic granularity — YAGNI. The six kinds + external face have no
functional gap. Future domains needing a new kind extend the closed set by
versioned vocabulary evolution, not pre-building.

### 7.2 Risk derivation — four levels, code-pinned policy

`RISK_LEVELS` (`runner-registry.js:774`, today `["low","medium","high"]`)
extends to `["low","medium","high","critical"]`; `RISK_POLICY_VERSION` bumps
to 2. Derivation table (extend `riskOf`, `:907`; "highest registered effect"
rule kept):

| Effect | Base risk | Escalation to critical |
| --- | --- | --- |
| read / prepare / diagnose | low | — |
| write-target | medium | — |
| deploy / rollback | high | `rollback === "none"` (`:226` declares no compensation) ⇒ critical |
| credential scoped + deploy/rollback | inherits effect risk | scoped credential on a high effect ⇒ critical |

Drift semantics come free: the policy version is pinned into every
`requestHash` (`:736-738` comment), so the bump invalidates stale approvals
through the existing drift refusal (`requestDriftProblem` family). Risk is a
derived value, not stored ("risk derives from the registered capability facts
through a versioned, code-pinned policy") — capabilities whose derived risk
rises to critical need no re-registration; their next requests walk the
critical approval tier.

### 7.3 Registry field extensions

| Field | Default | Validation / consumer |
| --- | --- | --- |
| `targetSchema` | `null` (= default target shape `{repository, paths[]}`, `requestTargetProblem`, `runner-registry.js:929-941`) | JSON Schema fragment compiled via `schema-contract.js` (repo discipline); request validation |
| `constraints` | `null` | declarative constraints (maxFiles / protectedPaths / whereRequired); consumed by the PEP at request validation (§6.2 v2 rule face) and RunScope |
| `idempotency` | `"unknown"` | enum `idempotent \| non_idempotent \| unknown`; settle-time replay of the same requestHash returns the existing settlement (`prepareRunnerExecution:1829` existence check + `settleRunnerExecution:1933`); concurrent same-key requests serialize on the existing execution lock (`EXECUTION_LOCK_CODE`, `:1522`) — no new concurrency primitive |
| `evidenceContract` | `null` (= all `RECEIPT_FIELDS`, `evidence-receipts.js:110`) | array of `{field, minAssurance}`; settle refuses a receipt missing a declared field (`AMBER_E_RUNNER_EXECUTION_INVALID` family); semantics ruled here, implementation owned by §8 |

Registration of the new fields is a **human-approved governance change**
unchanged: a new capability version event bound to a committed Decision (F052
discipline). The additions are same-version schema growth
(`SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS`): old events read the new fields
as null/unknown — append-only read-side compatibility.

### 7.4 Budget model — two tiers, deliberately

| Dimension | Loop tier (`loop-contract.schema.json` budget) | Run tier (RunScope constraints, run contract §3) |
| --- | --- | --- |
| duration | `maxMinutes` (+ deprecated top-level `budget`) | `maxDurationMs` |
| iterations | `maxIterations` (hardStops) | `maxToolCalls` |
| external calls | — | `maxExternalCalls` |
| cost | `maxUsd` | `maxCostUsd` |
| tokens | `maxTokens` | — (model tokens are host-domain; unmediated ⇒ unobservable, C0 §2 E4) |

`budget.exhausted` is a governed-runner ledger event
`{kind:"budget.exhausted", runId, dimension, limit, observed, prevHash,
hash}` (same append pattern as §6.5); the session state machine consumes it
into BLOCKED (§10.1). Run-level exhaustion settles the execution FAIL
directly — a single execution has no "waiting for budget" semantics.

## 8. Outcome / verification / provenance (0054)

### 8.1 Outcome field table — receipt columns + a fold projection, no third record

| Field | Storability | Semantics | Home |
| --- | --- | --- | --- |
| `status` | recordable (existing, `governed-runner.js:390` exitCode-derived pass/fail) | **execution fact** — did the command run to completion | unchanged |
| `verificationStatus` | **fold-derived, never stored** | `UNVERIFIED` (initial) → `PASSED` / `FAILED` / `PARTIAL` / `UNKNOWN` | `projectEvidenceRecord` projection (existing derived-state discipline, `evidence-receipts.js:22-24` "the ledger never stores derived state") |
| `sideEffects[]` | recordable, optional, default `[]` | declared effect landing points (capability effects × touched paths) — the data face of observed-vs-declared (C0 §2.3) | `RECEIPT_FIELDS` extension |

Derivation rules: no verify event and no gate outcome join ⇒ `UNVERIFIED`;
independent verify pass ⇒ `PASSED`, fail ⇒ `FAILED`; gate-outcome join
(`gate-evaluation.js` verdict) pass ⇒ `PASSED`, fail ⇒ `FAILED`, partial
multi-requirement ⇒ `PARTIAL`; **verify event and gate outcome in conflict ⇒
`UNKNOWN`** (explicit uncertainty, never a silent pick). "Task PASS with
Policy FAIL" is two different records — receipt `status=pass` and gate
`verdict=fail` — joined at read; no new expression primitive. A third
standalone Outcome record is rejected: Gate Outcome (`.amber/gates/`) already
is the independent verification record.

**A verified failure is still a failure.** `verificationStatus` never
overwrites `status`: a FAILED verification of a passed execution reads as
"executed, verification refused", and a PASSED verification of a failed
execution reads as "failed execution with passing evidence" — neither row is
edited, softened, or merged by the fold.

### 8.2 Dimension × method × producer × assurance-ceiling matrix

| Dimension | Method | Producer | Ceiling | Existing anchor |
| --- | --- | --- | --- | --- |
| policy | `policy-check` | PDP (gate 1) | observed | `evaluateGovernedPolicy` (`governed-runner.js:12` import) |
| execution boundary | `rule` | ExecutionBoundary adapter (§5.4) | observed | `ENVIRONMENT_PROFILES` (`runner-registry.js:743` area) |
| tools | `schema` | registry fold | observed | capability shape validation (F052) |
| context | `schema` | Loadout verification | observed | `context-loadout.js` hash discipline |
| tests | `test` | evidence-runner (execution) + independent verifier | **replayable** (with `replayOf`) | `evidence-runner.js`; `replayOfProblem` (`:288`) |
| diff | `diff-compare` | ExecutionBoundary adapter | observed | C0 §2.3 D2 (`AMBER_E_RUNNER_EXECUTION_SCOPE`) |
| scope | `diff-compare` | same | observed (violation ⇒ FAIL) | `runner-registry.js:1909-1923` (D1 claim check) |
| evidence completeness | `rule` | settle validation (§7.3 `evidenceContract`) | observed | `settleRunnerExecution:1933` |
| budget | `budget-check` | governed-runner | observed (exhaustion ⇒ FAIL) | §7.4 event |
| (synthesis) | `human-review` | **independent human Principal** | **verified** — the only route | `verifyEvidence`, verifier ≠ producer (`ASSURANCE_FORBIDDEN_CODE`, `evidence-receipts.js:685-689`) |

Closed method set (seven): `rule | schema | test | human-review |
policy-check | diff-compare | budget-check`. Per C0 §6.3's correction, an
independent **service** Principal may also verify (human review is
sufficient, not necessary); the producer never verifies its own claim.

### 8.3 Provenance ↔ Assurance — document mapping, no field

| v3.1 provenance | Amber assurance | Note |
| --- | --- | --- |
| CLAIMED | `unavailable` | host-path equivalence ruled by C0 §2 |
| OBSERVED | `observed` | direct |
| ATTESTED | reserved enum value | joins `ASSURANCE_LEVELS`, **not** `RECORDABLE_ASSURANCE` — record refuses, fold acknowledges existence; no signing/TEE infrastructure exists (0044 fog) |
| VERIFIED | `verified` | direct; independent verify event is the only route |

No `provenanceTier` field: one fact, one name (DRY); the mapping lives in
this table. The ATTESTED reserved value's implementation is this contract's
plan slice (ticket 0054 owns it; 0046 ruled the reservation).

### 8.4 Metrics — fold-only read projection

Minimum set: attempt counters per run contract §7 R2
(`attempts_requested/admitted/denied/settled{status}`);
`policy_decisions_total` / `policy_denials_total` (§6.5 events);
`approvals_granted_total` / `approvals_consumed_total` (approval fold);
`budget_exhausted_total` (§7.4 event). Excluded: `tool_calls_total`
(host-domain blind spot, C0 §2 E4 — unobservable ⇒ not aggregated) and
`context_grants_total` (until §10.3's reserved events are enabled).
Metrics are a rebuildable read model (Projection semantics): never
authoritative, never written back, degraded to unavailable rather than
estimated.

## 9. Replay / drift / bundle (0055)

### 9.1 R0 — handoff bundle extension, not a new command

`amber handoff bundle` gains `--replay-scope <sessionId|runId>`: the default
seven-file lightweight bundle (`handoff-bundle.js:201-219`: README,
session-summary, verification-evidence, next-actions, risks,
recovery-commands, manifest) is unchanged; the flag appends a `replay/`
directory with the minimum governance facts. **Bundle ownership: the handoff
bundle is the R0 carrier** — no new command, no new top-level artifact.

| R0 file | Content | Source |
| --- | --- | --- |
| `replay/manifest.json` | R0 inventory + per-file content hash + generation time | new (extends `buildManifest`) |
| `replay/session-manifest.json` | session manifest copy (RunScope frozen inputs per run contract §3) | run contract |
| `replay/timeline.jsonl` | the scope's chained run-events segment | §10.4 |
| `replay/governed-ledger.jsonl` | `policy.evaluated` / `executed` / `budget.exhausted` events | §6.5 / §7.4 |
| `replay/policy.json` + hash | rules copy + snapshot `policyHash` (one per policy version seen — run contract R-RP-4) | run contract §3 |
| `replay/capabilities.json` | touched capability registrations + `integrityDigest` | F052 |
| `replay/approvals.jsonl` | the scope's grants/revocations/consumptions | approval registry |
| `replay/loadout.json` | context snapshot (classification/redactions) | C0 §3.2 |
| `replay/receipts.jsonl` | the run's recorded evidence receipts | evidence-receipts |

Nine classes. R0 semantics: the authorization chain (policy → approval →
execution → evidence) is rebuildable from `replay/` alone, without chat
history; `handoff validate` extends to hash-verify `replay/` (fail closed).

### 9.2 R1 — decision replay as a pure read-only comparison

`replayPolicyDecisions(scope)`: fold the scope's `policy.evaluated` events
(each carrying its PDP input snapshot — capability × target × effect ×
constraints + `policyHash`); re-run the pure `evaluateCommandPolicy` v2 path
over the **stored evaluated request** (first verified against the frozen
`inputDigest`, run contract R-FR-0) using a **specified** (default: current)
rules version; compare `{original decision, new decision, original
matchedRule, new matchedRule}` per event. **Output is a comparison report,
not pass/fail** — R1 answers "how would the same inputs be judged today".
Report shape: per-decision table + summary
`{evaluated, exact, compatible, drifted, nonReplayable}`;
`COMPATIBLE` = decision unchanged, matchedRule changed;
`NON_REPLAYABLE` = input snapshot fields missing (e.g. legacy v1 events with
no capability face — run contract R-FR-4, never default-filled).

### 9.3 R2 — intentionally deferred; R3 — read/diagnose only

**R2 (capability replay) is deferred**, unchanged from 0044's scope ruling:
re-invoking a capability is execution, not replay; its read-only subset
overlaps R3. Re-evaluation happens only after the 0059 Runtime Adapter
lifecycle (C0 §5) is implemented. **R3 stays read/diagnose-only**: effects ⊆
{read, diagnose}; the implementation is a **new governed run** referencing
`replayOf` (four gates + single approval; `replayOfProblem` discipline:
replayable must carry `replayOf`, non-replayable must not); assurance ceiling
`replayable`. Replaying side-effecting capabilities is permanently out of
scope (0044).

### 9.4 Drift dimensions × comparison source × testability

| Dimension | Comparison source (original vs current) | Testable in Coding domain |
| --- | --- | --- |
| Policy | `replay/policy.json` hash vs current rules hash | **yes** (run contract snapshot) |
| Capability | `replay/capabilities.json` `integrityDigest` vs current registry | **yes** (F052) |
| Context | `replay/loadout.json` hash vs current Loadout | **yes** (C0 §3.2) |
| Runtime | `ENVIRONMENT_PROFILE_VERSION` (code-pinned) | **yes** (version compare) |
| Model | `execution_context.engine/model` (declared, pinned at capture) | **no** — host-domain declaration, not observation (C0 §2 E4) |
| Adapter | F051/F056 registration versions vs current | **yes** |
| Domain | replay-time git HEAD vs current HEAD | **yes** (git-state) |
| External state | F056 receipts' external-system declarations | **no** — Amber does not own external systems |

Four states: `EXACT` (all testable dimensions hash-identical) →
`COMPATIBLE` (version-domain compatible, e.g. rule id changed with decision
unchanged) → `DRIFTED` (any testable dimension differs) → `NON_REPLAYABLE`
(dependencies missing). **Untestable dimensions (Model, External state)
annotate only — they never participate in the verdict**: no false EXACT, no
false DRIFTED. `artifact-drift.js` (feature-path vs evidence-date heuristic)
remains a Domain-dimension supplementary signal, not merged into the table
(different granularity). Web viewer: read-only drift badge + R1 report link;
interactive replay is permanently excluded (Governance Console is not an
execution surface).

## 10. Lifecycle state machine / event taxonomy (0056)

### 10.1 State delta — one addition: BLOCKED

The v3.1 run-state machine is **run-level** and already exists as two Amber
surfaces: the session seven-state machine (`session-state-machine.js:3-23`)
and the F052 request statuses (`REQUEST_STATUSES = ["requested",
"authorized", "denied"]`, `runner-registry.js:733`) plus execution
prepared/settled/aborted. Mapping: CREATED ≡ session `created` + request
`requested`; PLANNED ≡ session `routed` (route binding is the plan template);
AUTHORIZED ≡ request `authorized` (run-level; **no session-level state
added** — admission completion is the request's `authorized`, run contract
§5); RUNNING ≡ execution `prepared` + session `executing`; COMPLETED ≡
settled(pass)/`completed`; VERIFIED ≡ gate outcome pass + evidence `verified`
(**not a state** — an independent proof fact); CLOSED ≡ accept + handoff
closure (**not a state**); PAUSED ≡ `paused`; FAILED ≡ settled(fail)/`failed`.

**The only increment: session gains `blocked` (eighth state).** Transition
table increment:

```
EXECUTING: [PAUSED, BLOCKED, COMPLETED, FAILED, ABORTED]   // +BLOCKED
BLOCKED:   [EXECUTING, ABORTED]                            // new row
EVENT_TYPES[BLOCKED] = "session_blocked"                    // new mapping
```

Drivers: `budget_exceeded` (existing timeline enum, `timeline-event.schema.json:25`), the §7.4 ledger `budget.exhausted` event, and ADR-0013 no-progress detection. BLOCKED is **not** added at run level: run-budget exhaustion
settles FAIL directly; blocking is a session-level recoverable state (same
family as paused). `BLOCKED → COMPLETED` is illegal: unblocking
(`session_unblocked`) precedes completion. Naming stays dual-surface by
design: timeline `budget_exceeded` (snake_case observation face) and ledger
`budget.exhausted` (dotted kind face) keep their names — one mapping line in
this contract, no rename burden. "Execution success does not auto-verify" is
already mechanical (RECORDABLE_ASSURANCE excludes `verified`; gate outcome is
an independent evaluation; `completed` ≠ verified) — restated here as spec,
no new mechanism. Recovery: pause/resume semantics are already covered by
`continueSession`; BLOCKED recovery reuses the `rejectResume` guard envelope
with human-review evidence.

### 10.2 Closed event enumeration — 18 existing + 11 new = 29

New timeline event kinds (schema `timeline-event.schema.json` enum extension,
optional new fields `runId` / `actor` / `sequence` appended gradually;
existing `artifact_sequence` untouched):

| New kind | Semantics | Source |
| --- | --- | --- |
| `run_started` / `run_completed` / `run_failed` | per-attempt run projection into the session timeline, carrying the full derived `runId` (run contract §2) | 0050 |
| `policy_denied` | PDP deny visibility | §6 |
| `approval_requested` / `approval_granted` / `approval_consumed` | approval lifecycle observation | §6.3 |
| `session_blocked` / `session_unblocked` | BLOCKED transitions | §10.1 |
| `context_granted` / `context_denied` | Context Firewall faces — **reserved-disabled** (see §10.3) | C0 §3.3 |

Excluded: v2's `tool.discovered/called/completed/failed` — host-domain tool
calls are unobservable under the blind-spot contract (C0 §2 E4: unobservable
⇒ not recorded). Illegal-transition refusals are eventized through the
existing `error` kind with `{fromState, toState, reason}` data — no new kind.

### 10.3 Timeline ledger ruling and the unresolved adoption gate

**The session `timeline.jsonl` chains via a `run-events` ledger family
declared through `defineLedgerFamily`** (ADR-0028 factory; no hand-written
second chain — 0045 conclusion). Existing plaintext timeline events (no hash
fields) are a **legacy prefix**: tolerated on read, never backfilled, never
re-chained; chaining and fold verification start at the first chained event
(the family's `preLink` extension, `ledger-family.js:18-24` area, adjudicates
legacy lines). Motivation: governance facts are tamper-evident while the
observation stream is not — an inconsistency §9's R0 and §8's provenance both
depend on closing.

**Unresolved adoption gate owned by 0056:** `context_granted` /
`context_denied` are **reserved-disabled** — present in the closed enum for
schema stability, emitted by no code. Their enabling ruling exists (C0 §3.3),
but enabling lands only in this contract's plan slice that extends the
timeline schema, gated on the context-runtime plan's Slice A (ingress
metadata). At HEAD the schema enum has 18 kinds and no `context_*` kinds —
**nothing about these events is implemented, and no test or doc may claim
otherwise.**

## 11. Compatibility / versioning / CLI / layout / PR sequence (0060)

### 11.1 Compatibility checklist

| Surface | Rule | Anchor |
| --- | --- | --- |
| rules.json v1 | zero migration; v1 command-text rules stay valid Coding-domain rules; v2 coexists, deny-wins across versions | §6.2 |
| approval registry / ledgers | zero migration; new binding fields are optional additions (ADR-0012); old grants read as pre-field records | §6.3 |
| execution ledger / F052 registry | zero migration; new request fields optional; `SUPPORTED_RUNNER_REGISTRY_SCHEMA_VERSIONS` same-version growth | §7.3 |
| session manifests / loop contracts | zero migration; no `runScope` authority field (run contract §7 R5); loop budget untouched | §7.4 |
| timeline events | legacy plaintext prefix tolerated, never upgraded | §10.3 |
| legacy attempts / receipts | read as pre-field records: `NON_REPLAYABLE` / completeness gap, never default-filled (run contract R-FR-4) | §9.2 |
| CLI | existing loop/plan/gate commands keep their current surfaces (v3.1 §27's "demote to domain compat commands" is **not** adopted — Amber's commands are already organized by journey/core tiers, F063; new subcommands register outside the default projection) | §11.3 |
| `.amber/` layout | no physical re-layout; v3.1's directory taxonomy is a read-side projection only | §11.4 |
| web / MCP | no new default verbs; MCP mutations stay approval-required | C0 §5.4; F018 |

### 11.2 Protocol-version strategy

**No `amber.dev/v1` umbrella apiVersion is introduced.** Versioning stays
per-artifact, following ADR-0012 (schema growth without version bump for
additive optional fields) and the code-pinned policy precedents:

| Versioned artifact | Version field | Location |
| --- | --- | --- |
| schemas (route/session/timeline/policy/loadout/…) | `schemaVersion` | inside each `schemas/*.schema.json` document |
| environment profiles | `ENVIRONMENT_PROFILE_VERSION` (code-pinned) | `runner-registry.js:737` |
| risk policy | `RISK_POLICY_VERSION` (code-pinned; bumps to 2 with §7.2) | `runner-registry.js` (near `RISK_LEVELS:774`) |
| capability / runner registrations | `runnerVersion` / `capabilityVersion` per event | F052 registry events |
| routes | `{id, version}` in the session manifest route pin | `schemas/session-manifest.schema.json` |
| policy rules | `schemaVersion` 1→2 (§6.2) + content `policyHash` | rules.json + run contract §3 |
| contracts (HarnessContract) | `contractHash` — a fingerprint, **not** a protocol version (run contract §4) | attempt records |

One sentence: **protocol versioning is artifact-local and content-hashed; the
only cross-artifact version authority is the frozen per-attempt tuple, never
a global API version string.**

### 11.3 CLI mapping — default verb count unchanged

| v3.1 §37 generic command | Amber mapping | Default surface? |
| --- | --- | --- |
| harness (status/overview) | `amber status` / `amber doctor` | `doctor` yes |
| identity | `amber principal …` (registry reads) | no |
| policy | `amber loop policy …` reads + §6.2 v2 surface (typed mutation, `--yes`) | no |
| capability | `amber runner register / capability / requests …` (F052) | no |
| context | `amber context ingest / loadout …` | no |
| run | `amber session run --execute / settle` (F062) + `amber runner request/prepare/settle` (F052) | no |
| evidence | `amber evidence …` (receipts/verify) | no |
| replay | `amber handoff bundle --replay-scope` (§9.1) + `replayPolicyDecisions` read path (§9.2) | no |

**Default verbs added: 0.** The default projection remains exactly
`audit, init, doctor, next, plan, handoff, session` (verified against
`scripts/lib/command-help.js` output at HEAD). New subcommands (e.g.
`--replay-scope`) register in `command-help.js` tiers outside journey/core
**and** in the CLI output FLAG_SPECS (the known registration blind spot: an
unregistered flag parses as a positional while unit tests stay green).

### 11.4 `.amber/` layout ruling — projection, not migration

The v3.1 taxonomy (`harness/ policy/ runs/ approvals/ capabilities/
contexts/ evidence/ audit/`) is realized as a **read-side projection
grouping** over the existing layout; **no physical migration**. Current
layout (grep-verified subdirectories in live use): `sessions, sync, context,
governance, retention, artifacts, evidence, memory, external, handoff,
adapters, principals, maintain, approvals, team, identity, gates, breakglass,
runner, loops, executions, staleness, release, profile, policies, knowledge,
provenance, audit, routes, reports, projections, maintenance, …`. Mapping
examples: v3.1 `runs/` → projection over `sessions/` + `executions/` +
attempt ledger folds; `capabilities/` → `runner/` registry; `contexts/` →
`context/`; `approvals/` → `approvals/` (already aligned); `audit/` →
`audit/` + ledger folds. Rationale: a physical re-layout breaks every
path-pinned reader for taxonomy cosmetics; the projection is a documentation
and query-layer concern. The only new physical directory authorized by the
four contracts is `.amber/research/` (C0 §6.2 citation store) and
`.amber/suggestions/review.jsonl` (B0 §8.2).

### 11.5 Code layout and dependency-guard plan

Per §5: logical grouping now (Core/Adapter markers + guard tests), physical
`src/` relocation deferred until a running second-domain consumer; `src/`
stays migration-utilities-only until then. The guard file
`tests/unit/core-domain-separation.test.js` lands in the first PR of the
sequence (G-1 below) with the known-deviation allowlist, tightening to
strict as splits land.

### 11.6 PR sequence draft (slices; the plan file carries the full detail)

| # | Slice | Source | Gate |
| --- | --- | --- | --- |
| G-1 | Dependency-guard tests (Core/Adapter markers, known-deviation allowlist) | §5.6 | lands green immediately |
| G-2 | Timeline schema: +11 event kinds (2 reserved-disabled), optional `runId`/`actor`/`sequence`/`prevHash`/`hash`; `run-events` ledger family with legacy prefix | §10 | none |
| G-3 | Session BLOCKED state (three small edits) + `budget.exhausted` ledger event | §10.1, §7.4 | G-2 |
| G-4 | Runner registry: four risk levels + escalation rules; registry field extensions (targetSchema/constraints/idempotency/evidenceContract) | §7 | none |
| G-5 | PDP: five-value decision enumeration + v2 rule schema + `policy.evaluated` event + approval tuple binding on loop surface | §6 | run-contract slices 1-3 (A0 plan) for session-surface binding |
| G-6 | Evidence: `sideEffects[]`, ATTESTED reserved value, `verificationStatus` fold, evidenceContract settle validation | §8 | G-4 |
| G-7 | Replay: `--replay-scope` R0 bundle + `replayPolicyDecisions` R1 + drift fold | §9 | G-2, G-5, G-6 |
| G-8 | Metrics fold (attempt counters, policy/approval/budget counters) | §8.4 | G-3, G-5 |
| G-9 | Core/Adapter splits in §5.5 migration order + `execution-domain-adapter.js` | §5 | G-1; per-step suites green |
| G-10 | Drift badge + R1 report link (web, read-only) | §9.4 | G-7 |
| G-11 | `.amber/` projection map doc + version-field table doc | §11.2/§11.4 | none (docs only) |

Cross-packet ordering: G-5's session-surface binding fields ride the A0
plan's slices 1-3; the context-runtime plan's Slice A precedes any enabling
of `context_granted`/`context_denied` (this contract's G-2 keeps them
reserved-disabled regardless); the evolution plan's rules deriver (slice 5)
unblocks only after G-5.

### 11.7 S1–S11 test-matrix ownership — unresolved

v3.1 §39's safety invariants S1–S11 **cannot be traced**: the V3.1 FINAL
source is missing (`SOURCE-V31`, goal packet `requirements.json`
`evidenceGaps[0]`; affects "0044 S1–S11/whole-plane completeness" and "0060
original invariant traceability"). **No S-number is quoted, mapped, or
claimed by this contract.** What is traceable today are the locally decided
invariant tests: run contract §10 (ten), context-runtime §8 (nine),
evolution spec §6/E1–E12, and this contract's per-section test obligations
(G-1…G-11). When `SOURCE-V31` is provided, a traceability ticket maps S1–S11
onto these matrices; until then every S-reference in any document reads as
**unresolved, not inferred from v2**.

## 12. Invariants

| # | Invariant |
| --- | --- |
| G1 | One plane, one owning contract; overlaps split by concern (§2 R-UM-1). |
| G2 | Decision coverage and implementation coverage are reported separately; nothing is claimed implemented without a code citation. |
| G3 | No second PDP, state machine, ledger implementation, proposal authority, or run-identity system is created (extend-only discipline). |
| G4 | The default CLI surface is exactly the F063 seven verbs; this contract adds 0. |
| G5 | Fail-closed everywhere: unknown decisions deny; untestable drift dimensions annotate; unresolvable replay inputs are `NON_REPLAYABLE`; missing evidence-contract fields refuse settle. |
| G6 | A verified failure is still a failure: `verificationStatus` is a fold projection and never rewrites `status`. |
| G7 | Grants bind the frozen tuple + attempt identity; drift refuses pre-effect; verification never revives a stale grant (inherited from the run contract). |
| G8 | Core never imports git semantics directly; the guard tests own the boundary (§5.6). |
| G9 | Timeline events are chained via the ledger-family factory; legacy plaintext is tolerated, never upgraded. |
| G10 | No whole-v3.1 compliance claim and no S1–S11 claim while `SOURCE-V31` is unresolved. |
| G11 | Budgets are two-tier by design; run-level budgets exclude model tokens (host-domain blind spot). |
| G12 | `.amber/` physical layout is stable; new directories only as authorized by the four contracts (research citation store, suggestion review ledger). |

## 13. Out of scope / ownership boundaries

- The three sibling contracts and their plans are **not modified by this
  packet**; where this contract reconciles a ticket against them, the sibling
  text is authoritative (§6.3 reconciliation recorded as a delta note).
- B2M owns maintenance-attribution code and the evolution plan status; C0R
  owns the context-runtime contract repair — untouched here.
- Ops adapter, multi-tenant isolation, attestation infrastructure,
  concurrency beyond §7.3, scheduled proposal generation, R2 replay,
  side-effecting replay, sandbox ownership, host interception: out of scope
  with their recorded preconditions (0044 fog; §9.3).
- No product code, schemas, apps/web, tests, eslint config, feature catalog,
  CONTEXT.md, or workflow state is modified by this contract packet; all
  implementation belongs to the plan's slices.

## 14. How this serves the product goals

- **No-chat trusted continuation (N):** the plane map (§2) plus the frozen
  tuple (run contract) give a receiver one authoritative join per execution:
  which policy version judged, which grant authorized, which capability ran,
  what evidence exists, and how to rebuild it offline (§9.1 R0).
- **Evidence completeness (S2):** every reconciliation row (§3) and every new
  field fails closed with an explicit reason; gaps are recorded, never
  defaulted.
- **Human overhead (S3):** drift becomes a pre-effect machine check (§6.3);
  risk escalation and budget exhaustion produce explicit, actionable states
  (§7, §10.1) instead of chat archaeology.
- These are contribution paths, not measured outcomes; no real-user metrics
  exist and none are claimed.
