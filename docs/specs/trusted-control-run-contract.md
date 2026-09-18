# Trusted Control Run Contract (0050)

**Spec ID:** `trusted-control-run-contract`
**Status:** proposed
**Updated:** 2026-09-16
**Review:** coordinator contract-review-01 findings (ST-01, A-SP-01..03, cross-ticket context constraint) repaired on 2026-09-16; re-review pending. This status records the authority lifecycle only — it is not acceptance, and runtime implementation has not started.
**Adoption authority:** Goal packet `.scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4` (user-approved objective); this spec converts the verified 0050 rereview proposal into canonical text. It is not a fabricated per-decision human ratification; residual choices are recorded as implementation choices in §7.
**Provenance:** `issues/0050-run-runscope-snapshot.md` (original 2026-09-15 rulings, partially superseded by the correction appended 2026-09-16); audit P1-01 (`.scratch/product-scope-audit/0044-0060-2026-09-16-QjqMvx/REPORT.md` §5); verified rereview v2 (`.scratch/orchestration/0050-contract-rereview-2026-09-16-W5CoFK/RESULT.md`, model checks `CHECKS.cjs` 10/10, coordinator regression `coordinator-counterexamples-v2.json` all-negative); consumer tickets 0051/0054/0055/0056.
**Depends on:** F050 (Decisions/Gates/Evidence/Assurance — approval, staleness, assurance discipline), F052 (runner registry — capability registration and fail-closed resolution), F062 (route stage verbs — the attempt model this contract freezes), ADR-0012 (schema growth), ADR-0028 (ledger family factory).
**Implementation plan:** `docs/plans/trusted-control-run-contract.md` (proposed; current implementation status: **not yet delivered**).

> Canonical contract for session/run/attempt identity, per-attempt frozen admission
> inputs, layered non-circular hashes, fail-closed authorization binding, and replay
> inputs in the Amber trusted-control boundary. One governed execution attempt is the
> frozen unit; `runId` is a lossless derivation of the full `(sessionId, attemptId)`
> tuple; Run is a read-only projection; the append-only session ledger — never a
> mutable manifest — is the only authority for frozen historical values; authorization
> validity is checked before any effect, and consumed or drifted authorizations are
> never revived by verification events.

## 1. Problem

The original 0050 rulings pressed three cardinalities onto one key and were not
simultaneously satisfiable (audit P1-01):

1. `runId` generated per attempt at prepare time (0050:55-60) vs. described as
   session-level and shared across attempts (0050:144) vs. `RunScope` declared stable
   across attempts (0050:76-77). A retry could not be attributed uniquely.
2. `contractHash` depended on `scope_hash` while being stored back inside the hashed
   `runScope` object (0050:78-79 vs. 95) — circular.
3. Snapshot hashes lived in the mutable session manifest (0050:114, 133-134), which
   itself mutates (`updatedAt`, `status`, `currentStage`) — a mutable reference is not
   a frozen historical snapshot, and the proposed `admissionHash` name collides with
   the existing canonical-artifact admission hash (`scripts/lib/core/canonical-artifacts.js:397`).

Source facts this contract builds on (verified at HEAD `0a9cbeab`): the `glx-`
prefixed id in `governed-runner.js:273` is a worktree name only; the real attempt
model already exists in `session-stage-runner.js` (`attemptId` UUID at `:476`,
`attemptNumber` at `:511`, idempotency key including `attemptNumber+fence` at
`:455-462`, append-only `stage_attempt_requested`/`settled`/`expired` events);
approval consumption is single-use by `approvalKey` reference (`loop-ledger.js:67-78`);
F052 settles at most one execution per authorization (`runner-registry.js:1875-1879`)
and fails closed on runner version drift / integrity mismatch (`:1862-1863`).

## 2. Identity and cardinality

| Layer | Object | Identity | Lifecycle | Authority | Mutability |
| --- | --- | --- | --- | --- | --- |
| Work unit | session (Work Item) | `sessionId` (existing UUID) | session start → accept/handoff | session manifest (state) + session ledger (facts) | manifest mutable; frozen facts only in ledger |
| Execution try | attempt | `attemptId` (existing per-try UUID) + `attemptNumber` (per stage) | `stage_attempt_requested` → `attempt_admitted`/`attempt_denied` → `stage_attempt_settled`/`stage_attempt_expired` | session ledger (append-only, prevHash-chained) | immutable; status is fold-derived |
| Run | projection of one attempt's governed window | `runId` (see below) | admission → settlement | projection over attempt records, gate outcomes, evidence receipts, approval consumption, `executed`/`settled` ledger events | read-only |

Rules:

- **R-ID-1** `runId := "run-" + sessionId + "-" + attemptId` — the **complete** UUIDs,
  no truncation, no timestamp, no random component. It is a pure derivation of the
  full `(sessionId, attemptId)` tuple and is recomputable offline from any record
  carrying the tuple. Same-prefix UUIDs must never collide.
- **R-ID-2** A short display label may be rendered for humans but is never a lookup
  or authority key. Any join, `--replay-scope` resolution, or fold comparison uses
  the full `runId` or the tuple itself. A stored `runId` that differs from the
  derived value is a fold error (fail closed).
- **R-ID-3** The `glx-{label}-{ts}-{hex}` value stays a worktree name
  (`governed-runner.js:273`) and never enters evidence, ledger, or approval records.
- **R-ID-4** No session-level `runId` field is introduced; cross-attempt grouping is
  the existing `sessionId` (already threading evidence paths `:371`, receipt scope
  `:376`, ledger subjects).
- **R-ID-5** Retry: a retry of the same (session, stage) is a **new attempt**
  (`attemptNumber + 1`, new `attemptId`, new `runId`); the idempotency key
  (`attemptNumber+fence`, existing) is unchanged, and a duplicate key returns the
  existing record without forking.
- **R-ID-6** One gate pass per attempt: an admission refusal is terminal for that
  attempt (`attempt_denied`); retrying with a new authorization is a new attempt, not
  a revival of the denied record. `session continue` resumes the same attempt's open
  window (0056 semantics, unchanged).
- **R-ID-7** "Stable across attempts" is an observable outcome, not an invariant:
  unchanged inputs ⇒ identical base hashes across attempts; changed inputs ⇒ each
  attempt freezes its own values. Identical hashes never merge attempt identities.

## 3. Frozen admission record (values + hashes)

Freezing = **values + hashes**. The values are the replay inputs; the hashes are
integrity checks and join keys, never replay inputs.

| Frozen input | Stored value (replay input) | Hash | Capture timing |
| --- | --- | --- | --- |
| scopeInputs | the six-field closed set: `capabilities[]`, `targets[]`, `constraints`, `context_scope`, `side_effect_policy`, `expiration` — resolved per the 0050:72-75 derivation table (route stage verbs, worktree + feature paths, Loadout, rules.json, lease expiry). `context_scope` is the authority-relevant context structure derived from the Loadout — the closed `constraints` sub-object `{maxClassification, purpose, expiresAt, accessBoundaries}` defined in `trusted-control-context-runtime-contract.md` §4; the Loadout content hash itself is captured separately as `contextHash` and never inside `context_scope` | `scopeHash` | at `stage_attempt_requested` append, before gates |
| evaluated request | the exact resolved command/argv the gates will evaluate, stored verbatim (never a live caller value at replay time) | `inputDigest` (see below) | same |
| policy | the complete parsed rules object (or a content-addressed immutable copy whose hash is verified before parsing) | `policyHash` | same |
| capability pins | the full registered capability records for the pinned capabilities (`runnerId`, `runnerVersion`, `name`, `capabilityVersion`, `effects`, `pathPrefixes`, `timeoutMsMax`, `credentialRequirement`, `rollback` — the registered field set, `runner-registry.js:70-86`), not a bare digest label | `capabilityHash` | same |
| context | existing Loadout content hash (referenced; the Loadout is already hash-pinned) | `contextHash` | same |
| execution profile | `execution_context` values (schema `session-manifest.schema.json:64-73`) | `executionProfileHash` | same |

Rules:

- **R-FR-0 (request binding).** The evaluated request has its own explicit integrity
  binding, separate from `policyHash` (rules only) and `contractHash` (Layer 0 +
  route). `inputDigest := sha256Hex(canonicalJson({resolvedCommand, argv (ordered,
  verbatim), capabilityPin, routeHash, stageName, attemptNumber, fence}))`, computed
  at capture and stored in the existing native `inputDigest` field of the request
  record (`session-stage-runner.js:481` — declared today, always `null`, never
  consumed; this contract fills it). It composes with, and does not replace, the
  existing `idempotencyKey` (`:240-246` hashes identity fields but excludes command
  content — two different requests under one key were indistinguishable). Consumers
  take exactly the bound value: the gate path verifies, before execution, that the
  request it is about to execute hashes to the frozen `inputDigest` (R-AD-3), and
  `settle`/replay verify the same digest. Two requests allowed by the same rules, or
  sharing a route version, or differing only in argv order, therefore have different
  `inputDigest` values and can never be silently interchanged.
- **R-FR-1** The attempt record is the only authority for frozen historical values.
  Retrieval is a ledger fold by `attemptId`. A mutable manifest (including any
  optional human-readable `runScope` declaration) is never a frozen snapshot.
- **R-FR-2** The ledger boundary serializes/clones frozen values on append; later
  mutation of caller/source objects cannot change a captured snapshot.
- **R-FR-3** Capability pins bind **registered semantics** (the full field set above).
  `capabilityHash` is computed over the canonical form of those records, so a
  registry change to effects, path prefixes, timeouts, or rollback semantics is a
  drift — not merely an integrity-digest label swap.
- **R-FR-4** Legacy attempts recorded before these fields exist read as "no frozen
  inputs": replay for that attempt is `NON_REPLAYABLE`, evidence completeness scores
  a gap, and no default or current value is ever inferred for them. Legacy records
  never gain assurance by this contract (P1-06 discipline).

## 4. Hash layering and canonicalization

```
Layer 0 (independent, from raw values or existing hashes only):
  scopeHash            ← scopeInputs (unordered fields sorted)
  policyHash           ← complete rules object (order preserved)
  capabilityHash       ← full registered capability records (set-sorted)
  contextHash          ← existing Loadout hash (referenced)
  executionProfileHash ← execution_context values
Layer 1 (computed last):
  contractHash         ← canonical({route:{id,version}, scopeHash, policyHash,
                          capabilityHash, contextHash, executionProfileHash})
Invariants:
  - a derived hash never appears in the input of any hash, including its own;
  - contractHash consumes Layer 0 + route identity only and is never written
    back into any hashed object.
```

- **R-HA-1** Canonicalization reuses `context-hash.js` (`canonicalJson` sorted keys
  `:123`, `sha256Hex` `:22`). No new hash function.
- **R-HA-2** The **unordered (set-like) allowlist is explicit and closed**:
  `scopeInputs.capabilities`, `scopeInputs.targets`, and the capability-record
  aggregation are sorted before hashing. Everything else — policy rule arrays,
  argv/command sequences — is **order-sensitive and preserved verbatim**; reordering
  a sequence-sensitive array must change the hash.
- **R-HA-3** The derived contract fingerprint is named `contractHash`. The name
  `admissionHash` is rejected: it is already the canonical-artifact admission
  binding (`canonical-artifacts.js:397-429`) and the original 0050 usage conflated
  it with `scope_hash`.
- **R-HA-4** `contractHash` does not include the attempt identity; two attempts with
  identical inputs share `contractHash` (a useful drift observation) while remaining
  distinct identities (R-ID-7).

## 5. Admission sequence: request capture is not successful admission

- **R-AD-1** `stage_attempt_requested` captures **request intent plus frozen inputs**.
  It is not evidence of admission. Admission outcomes are separate appended events:
  `attempt_admitted` (with `admittedAt` and the recorded policy verdict) or
  `attempt_denied` (with an explicit refusal reason).
- **R-AD-2** Attempt status (`requested` → `denied` | `admitted` → `settled`) is
  fold-derived from events; the ledger never stores derived state
  (`evidence-receipts.js:22-24` discipline). Only an admitted attempt may
  execute/settle.
- **R-AD-3** **Gates verify before effects.** Before policy evaluation, execution,
  or approval consumption, the gate path verifies:
  1. the request it is about to execute hashes to the frozen `inputDigest`
     (R-FR-0 — the executed request is the frozen request, never a re-derived or
     caller-substituted one);
  2. the policy it is about to evaluate hashes to the frozen `policyHash`;
  3. the current registry's pinned capability records hash to the frozen
     `capabilityHash` (F052 `resolveRunner` fail-closed drift refusal preserved,
     `runner-registry.js:1862-1863`);
  4. the policy evaluation itself passes (existing `evaluateGovernedPolicy`/
     `evaluateCommandPolicy` seam);
  5. approval consumption eligibility (§6).
  Any mismatch appends `attempt_denied` and stops — the approval is not consumed,
  nothing executes. Drift is refused at the gate, never merely noticed in a later
  fold after the effect.
- **R-AD-4** `policy.evaluated` events (0051) re-record the policy hash actually
  used; under R-AD-3 this equals the frozen value by construction — the re-record is
  assertive redundancy, and a mismatch would itself be a tamper signal.
- **R-AD-5** The four-gate structure of `governed-runner.js` (ledger/policy/
  confidence/approval/worktree) is reused; no new gate surface, no parallel state
  machine. Run states are folds over existing events only.
- **R-AD-6 (callable startup sequence — capture → grant → execute).** A grant is
  never bound to an attempt UUID that has not been created. The sequence for an
  approval-requiring stage is:
  1. **Capture.** `session run` appends the durable `stage_attempt_requested`
     (attemptId, frozen values, `inputDigest`) and returns a pending
     `awaiting-authorization` outcome WITHOUT executing when no eligible grant
     exists. This is an evolution of the current code, not its present behavior —
     today `approvalRef` is read before the attemptId exists
     (`session-stage-runner.js:507-512`), and dry-run creates no attempt at all
     (`:373-410` resolves and returns a projection only). The durable-pending
     precedent already exists for host-agent stages (`:548-556`). The existing
     `approvalRef` pointer (request names the approvalKey it intends to consume,
     `:507-509`) is retained as the reverse pointer; the grant's `boundAttemptId`
     closes the mutual binding.
  2. **Grant.** The human authorization step records the grant bound to the
     captured `attemptId` and its frozen hashes (`boundAttemptId` + the §6 tuple).
     The grant-writing surface is the approval surface of the executing seam
     (session ledger `approved` record / approval registry), extended with the
     binding fields — **a proposed API evolution, classified as proposed, not
     existing**.
  3. **Execute.** Gates run for that captured attempt (`attemptStatus` must be
     `requested`): R-AD-3 checks, eligibility, consumption, execution, settlement
     in the same call.
  Recovery: a captured-but-ungranted attempt stays `requested` and expires through
  the existing lease path (`stage_attempt_expired`, `:985`); a crash after capture
  consumes nothing; a denial is terminal for that attempt (R-ID-6) and a retry is a
  new capture with a new grant. No hand-written ledger entries, no guessed IDs, and
  no unbound grants are valid shortcuts at any step.

## 6. Authorization binding and consumption (fail-closed)

- **R-AU-1** A grant binds the three-hash tuple plus attempt identity:
  `{scopeHash, policyVersion (=policyHash), capabilityHash}` and, by default,
  `boundAttemptId` (attempt-specific grants by default, §7 R3). The Loadout context
  hash is deliberately not bound — but with a bounded qualifier: only **ordinary
  content refresh** (unchanged authorization-relevant context constraints) leaves a
  grant valid. Authorization-relevant context constraints — **classification,
  purpose binding, TTL/expiry, and access boundaries** — are frozen inside the
  existing `scopeInputs.context_scope` container, not a seventh field: the closed
  `constraints` sub-object `{maxClassification, purpose, expiresAt, accessBoundaries}`
  defined in `trusted-control-context-runtime-contract.md` §4 (0053's canonical
  contract, which supplies the exact field names and shapes). Because the Loadout
  content hash lives only in the separate Layer-0 `contextHash`, a content refresh
  leaves `scopeHash` — and the grant — valid, while any `constraints` change is scope
  drift and refuses at consumption; an expired `expiresAt` refuses with
  `context-expired` before any effect. Until those fields exist, `context_scope` is
  `null` on captured attempts: an explicit recorded absence meaning no
  context-constraint check existed — stated honestly as not-yet-checkable, never
  silently skipped or claimed as covered. Unconstrained `contextHash` drift remains
  observable via `contractHash`.
- **R-AU-2** `capabilityHash` binding is mandatory. A registry change is an
  authority change; F052 already refuses version drift / integrity mismatch
  fail-closed, and an unbound hash would void that refusal.
- **R-AU-3** Consumption eligibility is checked in order, each refusal explicit and
  **before any effect**:
  1. single-use: already consumed ⇒ refuse (`approval-already-consumed`), even when
     every hash matches;
  2. `scopeHash` mismatch ⇒ refuse (`scope-drift`);
  3. `policyVersion` mismatch ⇒ refuse (`policy-drift`);
  4. `capabilityHash` mismatch ⇒ refuse (`capability-drift`);
  5. `boundAttemptId` set and ≠ consuming attempt ⇒ refuse
     (`attempt-identity-mismatch`) — two different attempts with identical hashes
     never silently share an attempt-bound grant.
- **R-AU-4** Grants are terminal and scoped: consumption is single-use
  (`loop-ledger.js:67-78` semantics preserved), and a consumed, drifted, or
  identity-mismatched grant is never revived by a verification event. The only path
  after drift is a new human authorization bound to the new frozen tuple.
- **R-AU-5** Actor boundaries are those of F050 and the approval registry:
  human-only authority slots, principal identity rules, revocation and expiry
  semantics are unchanged and not restated here. A helper that only compares hashes
  must be named as a comparator; consumption eligibility is a separate, explicitly
  reasoned check.

## 7. Resolved implementation choices (former v2 residuals)

These are implementation choices adopted under the goal packet's authority, not
invented human registry events; each is now a written invariant of this spec:

| # | Choice | Invariant |
| --- | --- | --- |
| R1 | `runId` form | Readable full-tuple string (`run-{sessionId}-{attemptId}`); lossless, so the readable form is chosen over an equivalent digest |
| R2 | Metrics granularity | Attempt counters count the full capture population with explicit inclusion: `attempts_requested_total` (every `stage_attempt_requested`), `attempts_admitted_total` (`attempt_admitted`), `attempts_denied_total` (`attempt_denied`), `attempts_settled_total{status}` (`stage_attempt_settled`; `settled ⊆ admitted`). Inclusion: `requested = admitted + denied + still-open (requested-not-yet-gated or expired)`; a gate-refused retry counts in `requested` and `denied`, **never** in `admitted`. Session terminal states are counted separately, never merged into one `completed`. Worked example: one session, fail → gate-refused → succeed = `requested 3, admitted 2, denied 1, settled{failed:1, succeeded:1}` |
| R3 | Grant binding scope | Attempt-specific grants by default (`boundAttemptId` set at grant time); a grant without `boundAttemptId` is an explicitly scoped exception, not the default |
| R5 | Manifest authority | No `runScope` authority field in the session manifest; the current-scope read view is a fold of the latest attempt's `scopeInputs`; an optional non-authoritative declaration may exist only if labeled as such |

R4 (non-session surfaces) is a dependency contract, §8.

## 8. Dependency contract: non-session surfaces (former R4)

The core contract (§2-§6) is anchored on the F062 session-stage surface. Two other
governed execution surfaces exist; this section states the concrete mapping and the
exact unresolved facts. **A generic "same shape" claim does not implement them.**

### 8.1 Loop surface (`amber loop run --execute` → `loop-execution.js`)

- **Source facts:** `loop-execution.js:90-95` calls `runGovernedCommand` with
  `subject: { contractId }` only — **the loop surface has no attempt identity
  today**; its execution identity is the `contractId` plus the consumed
  `approvalKey` on the `executed` record; grants are `kind:"approved"` records with
  `approvalKey` in the loop ledger.
- **Mapping:** the loop `approved` record gains the same three-hash tuple
  (`scopeHash`, `policyVersion`, `capabilityHash`) so §6 eligibility applies
  verbatim at the governed-runner approval gate; frozen policy/capability values for
  loop executions live in the loop ledger events (the `denied`/`executed` records
  already carry subject context).
- **Exact unresolved fact:** whether the loop surface gains its own attempt identity
  field (e.g. `loopRunId` distinct from `contractId`) or binds grants to the
  contract-scope only. **Owner: 0051 (approval binding fields) with 0052 (budget/
  capability events).** This spec requires only that whatever identity the owner
  chooses, R-AU-3(5) identity binding and R-AU-4 terminality hold.

### 8.2 F052 surface (`runner-registry.js` request → prepare → settle)

- **Source facts:** `requestHash` is already the retry identity — one authorization
  settles at most one execution (`:1875-1879`); the request record carries the
  capability pin (`runnerId`/`runnerVersion`/name/`capabilityVersion`) and target
  (`repository`/`paths`); `prepareRunnerExecution` fails closed on unknown runner,
  version drift, and integrity mismatch (`:1862-1863`); receipt scope confinement is
  enforced at settle (`:1909-1923`).
- **Mapping:** for session-mediated F052 executions (F062 stage verbs route through
  `session-stage-runner` → `governed-runner`), the session attempt record of this
  contract **is** the frozen home; no duplicate freezing is added on the F052 side.
  For direct (non-session) F052 executions, the request record already freezes
  capability and target; what it lacks is the policy binding (`policyHash`) and the
  scope tuple.
- **Exact unresolved fact:** whether the F052 request record gains
  `policyHash`/`scopeHash` fields or direct non-session F052 usage is restricted to
  surfaces that carry their own frozen policy proof. **Owner: 0059 (runtime adapter
  lifecycle mapping, per audit P1-08).** This spec requires only that whichever
  shape the owner picks, R-AU-2/R-AU-3 hold before `prepare` succeeds.

## 9. Replay inputs

- **R-RP-1** Replay consumes frozen **values** with hash verification first:
  recompute all base hashes from the stored values and compare; only then parse and
  re-evaluate. Hash-only records, missing bodies, and tampered bodies (value-hash
  mismatch) are `NON_REPLAYABLE` for that attempt — never silently degraded, never
  default-filled.
- **R-RP-2** Policy replay is a real deterministic evaluation: the existing pure
  `evaluateCommandPolicy` (`loop-policy.js:67`; object input reads no live files)
  runs the **stored evaluated request** — first verified against the frozen
  `inputDigest` (R-FR-0) — against the **stored rules object**, reproducing the
  recorded gate verdict. Live rules, manifests, and registries are not consulted;
  a bundle works offline after the working copy is deleted.
- **R-RP-3** An after-execution Evidence receipt (`environment.runId`+`scopeHash` as
  join keys) is never a substitute for the earlier admission inputs; absence of
  admission inputs for an attempt is a replay refusal and an evidence-completeness
  gap (0054), not a warning.
- **R-RP-4** Replay bundles that span policy versions carry each attempt's
  hash-pinned policy copy (a retry across a policy change needs both versions).

## 10. Testing decisions

The implementation plan maps each item below to a concrete test; the proposal model
checks (`.scratch/orchestration/0050-contract-rereview-2026-09-16-W5CoFK/CHECKS.cjs`,
10/10) are pre-implementation evidence of model self-consistency, not product
acceptance:

1. same-prefix `attemptId`s yield distinct `runId`s (no truncation);
2. duplicate admit does not fork; retry never overwrites prior attempt history;
   source-object mutation after capture does not change the stored snapshot;
3. consumed grant refused despite matching hashes; capability-drift grant refused;
   attempt-bound grant refused for a different attempt with identical hashes;
4. hash-only / missing-body / tampered-body records are `NON_REPLAYABLE`;
5. reordered policy rules (sequence-sensitive) change the hash; reordered set-like
   fields do not;
6. gate-time policy or capability drift refuses before execution and before
   consumption, with the approval left unconsumed;
7. crash recovery: an attempt left `requested` (crash between capture and gates)
   never executes; resume or retry follows R-ID-5/R-ID-6;
8. offline replay reproduces recorded verdicts from bundle values only;
9. request binding (R-FR-0): two different requests allowed by the same rules, or
   sharing a route version, or differing only in argv order, produce different
   `inputDigest` values and can never be interchanged; an identical request
   reproduces the digest; a gate execution whose resolved request hashes to a
   different digest than the frozen one refuses;
10. capture→grant→execute (R-AD-6): a captured attempt with no eligible grant
    returns awaiting-authorization and executes nothing; after a grant bound to
    that attempt, the same attempt passes gates and settles; a grant naming a
    non-existent attemptId is refused.

## 11. Out of scope / owning tickets

Domain-specific decisions stay with their owning tickets; this spec defines the
identity/freeze/binding fields those owners must supply:

| Topic | Owning ticket | Fields this contract requires from that owner |
| --- | --- | --- |
| Staleness propagation and any revival-or-refusal mechanics beyond "no revival by verification" | 0051 | grant field names on approval-registry AND loop-ledger surfaces; `policy.evaluated` event referencing the attempt's frozen record instead of duplicating inputs |
| Verification event semantics, assurance levels, metrics writer | 0054 | receipt `environment.runId`+`scopeHash` join fields; `runs_*` fold source = attempt records |
| R0/R1 bundle contents, COMPATIBLE strength | 0055 | per-attempt frozen-record slices; hash-pinned multi-version policy copies; `--replay-scope` runId semantics |
| Timeline events, legacy chaining | 0056 | `run_started`/`run_completed`/`run_failed` per attempt with lossless `runId`; legacy events never upgraded |
| Loop/F052 surface field shapes | 0051/0052/0059 | per §8 exact unresolved facts |

Also out of scope: new CLI verbs, `.amber/` re-layout (0060), new ledger families
(0045), sandbox/runtime ownership, automatic approval, and any V3.1 S1-S11 wording
claims — the V3.1 FINAL source file is not present in its declared location
(`.scratch/harness-v2/`); this gap is recorded in the goal packet
(`requirements.json` evidence gap `SOURCE-V31`) and this spec deliberately makes no
whole-v3 compliance claim.

## 12. How this serves the product goals

- **No-chat trusted continuation (N):** a receiver attributes first-failure vs.
  gate-refused retry vs. successful retry, and "which authorization covered which
  execution," by mechanically joining `(runId, frozen tuple, approval consumption)`
  — the audit §9 exit criterion ("different readers reach the same run attribution,
  authorization validity, and replayable inputs") holds by construction.
- **Evidence completeness (S2):** frozen values in append-only records make the
  writer→bundle→reader chain field-by-field checkable; gaps fail explicitly
  (`NON_REPLAYABLE` / completeness FAIL).
- **Human overhead (S3):** drift becomes a machine-checkable pre-effect refusal
  instead of chat archaeology; the cost is a bounded set of frozen fields per
  attempt admission (no new command surface).
- These are contribution paths, not measured outcomes; no real-user metrics exist
  yet and none are claimed here.
