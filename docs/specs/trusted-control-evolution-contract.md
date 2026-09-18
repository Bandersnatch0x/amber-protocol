# Trusted Control Evolution Contract (0048/0057)

**Spec ID:** `trusted-control-evolution-contract`
**Status:** proposed
**Updated:** 2026-09-16
**Review:** coordinator contract-review-01 findings (ST-01, B-SP-01..04) repaired on 2026-09-16; re-review pending. This status records the authority lifecycle only — it is not acceptance, and runtime implementation has not started.
**Adoption authority:** Goal packet `.scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4` (user-approved objective). This spec converts the 0048/0057 rulings — corrected per audit P1-07 — into canonical text. It is not a fabricated per-decision human ratification; residual choices are recorded as implementation choices in `docs/plans/trusted-control-evolution.md`.
**Provenance:** `issues/0048-trajectory-attribution-adoption-boundary.md` and `issues/0057-evolution-proposal-evidence-contract.md` (original 2026-09-15 rulings; corrections appended 2026-09-16, both pending coordinator review); audit P1-07 and per-ticket recommendations (`.scratch/product-scope-audit/0044-0060-2026-09-16-QjqMvx/REPORT.md` §5, §7); consumer sources F064 (`docs/specs/F064-improvement-suggestions.md`), F054, F055, F052, F050, F058, ADR-0009, ADR-0018, ADR-0014, ADR-0028, issue 0051 (rules v2 / policyHash staleness).
**Depends on:** F064 (Improvement Suggestions — the only realized proposal destination today), F054 (maintain Findings/Trigger Proposals/triage), F055 (retention classification and deletion proof), F052 (capability registration governance), F050 (Decisions/Approval/staleness), F058 (instruction-surface evals; eval non-authority), ADR-0009 (Distillation Contract topology), ADR-0018 (governed memory layer), ADR-0014 (`next` is not an LLM router), ADR-0028 (ledger family factory), 0051 rules v2 (behavior-surface destination; not yet landed — visible dependency).
**Implementation plan:** `docs/plans/trusted-control-evolution.md` (proposed; current implementation status: **not yet delivered**).

> Canonical contract for the trusted-control evolution loop: one attribution value
> shape shared by existing proposal consumers; every proposal destination routed to
> its existing owner surface for admission, review, and apply; deterministic validity
> checks that prove form and never semantic truth; a rejection record that is
> append-only as a mutation discipline while retention stays with F055; model-driven
> generation only through host agents under Distillation Contracts; and recurrence
> claims that require a comparable exposure denominator. No auto-apply, no
> Amber-invoked model, no second proposal authority, no eval-authorized behavior
> change.

## 1. Corrections this contract makes authoritative

The 0048/0057 rulings stand except where corrected below. Each correction names the
original claim, the corrected rule, and its authority anchor. Ticket Log entries in
0048/0057 (appended 2026-09-16, pending coordinator review) link here; the historical
decision text is preserved unchanged in the tickets.

| # | Original claim (0048/0057) | Corrected rule | Authority |
| --- | --- | --- | --- |
| C1 | 0057 §2 groups "wiki / memory / instruction-surface" as one low-approval knowledge class walking F064 Apply | Destination is not permission. `MEMORY.md` is **refused** by F064 Apply and is governed exclusively by the ADR-0018 pipeline (`ingest → approve → human write → book`); Amber never writes the file. AGENTS.md/CLAUDE.md/skills are in the F064 Apply allowlist, but the current planner emits wiki creates only; "allowlisted" must never be described as "planned and applied". All three remain valid proposal **destinations** — the correction is routing, not deletion. | F064 §4/§6; `apps/web/server/lib/suggestions/paths.ts:29-37`; `apps/web/server/lib/suggestions/planner.ts:69-88`; ADR-0018 D5 |
| C2 | 0057 §4 places the whole proposal lifecycle in a new `evolution-proposals` ledger family | No second proposal authority. Suggestions, Maintenance Proposals, and canonical Intents remain distinct objects with their own lifecycles and owning records. The attribution block (§3) is a shared value shape referenced by existing consumers, not a merged proposal object. The one new ledger is scoped to the F064 suggestion review trail only (§8), because that trail has no durable owner today; every other rejection history already lives in an owning ledger. | Audit P1-07 minimal revision; ADR-0018 D4 (closed event set); F054 (maintain ledgers); F050 (policy outcomes record denials) |
| C3 | 0057 §3 presents V1–V3 as "确定性校验" without separating mechanical form from semantic judgment | V1–V3 are mechanical presence/shape checks. They prove that an evidence reference exists, that no capability-reducing operation is declared, and that a dual-axis effect statement is present — never that the evidence is true or the effect real. The semantic judge is the human reviewer at the destination's review stage. Eval results cannot authorize policy, capability, route, or instruction-behavior changes (F058; `eval run` is report-only, not Approval). | F058; AGENTS.md eval entry; F064 spec §Vocabulary |
| C4 | 0048/0057 record rejection history as "append-only 永久" (permanent), by analogy to ADR-0018 supersession | Append-only is a **mutation discipline** (no in-place edits, no deletion by the evolution surface), not a retention verdict. Retention classification, TTL, legal basis, and any future deletion belong to F055 and the tenant retention Policy through their own governed process. Records carry minimal provenance (fingerprint, reason code, redacted summary) — never raw transcripts. | F055 (retention classes, deletion candidates, Deletion Proof); ADR-0018 D3 (supersession governs memory entries, not evolution records) |
| C5 | 0057 §6 reads recurrence as fingerprint occurrence counts (Apply 前后频率对比) | Recurrence is a **rate over an exposure denominator** (transcripts scanned, sessions in window, or the declared F054 window). An improvement claim must compare like-for-like exposure; a raw count drop caused by lower usage is not improvement. When the denominator is unknown or unavailable, the report says `unknown` — it never fabricates a metric. Report-only; automatic best-harness selection stays rejected (0048). | Audit per-ticket recommendation for 0057; F064 §3 (cluster over scanned transcripts); F054 (window-bound findings) |
| C6 | 0057 §4 names the new family `evolution-proposals` with kinds `proposed\|validated\|rejected\|applied` covering all evolution proposals | The family is renamed and scoped to its actual responsibility: `suggestion-review`, the durable review trail of F064 suggestion cards (§8). Rationale: the fingerprint-keyed rejection history that motivates the ledger exists only on the F064 path (tool name + normalized first error line); maintenance proposals carry no such fingerprint, F054 findings have their own, and their rejection histories are already recorded by their owners. The kind set gains `undone` because F064's existing Undo action otherwise leaves an `applied` event misstating the current world. | F064 §3/§5 (fingerprint; Undo action); `apps/web/server/lib/suggestions/apply.ts:121-165`; F054 (detector fingerprints); audit P1-07 |
| C7 | 0057 §5 routes model-generated knowledge proposals for "wiki/memory/instruction-surface" through one Distillation Contract story | Kept for wiki and instruction-surface **text generation**. For memory, the generation product materializes as a memory request entering the ADR-0018 pipeline with its existing provenance vocabulary; the evolution contract adds no memory fields (ADR-0018's closed sets change only through that spec's own amendment path). For instruction-surface, generation is not application: writing AGENTS.md via Apply requires the future planner revision described in F064 §4, and instruction edits change agent behavior, so they are not low-risk by filename. | ADR-0009/CONTEXT.md "Distillation Contract"; ADR-0018 D5/D6; F064 §4; F058 |

## 2. Vocabulary (provenance boundary)

Self-owned terms only; upstream trajectory terms (SHE, Rule Bank, Safety Memory,
best-harness, ValidEdit) do not enter product content (ADR-0008 §4 discipline,
reaffirmed by 0048).

| Concept | Amber term | Definition |
| --- | --- | --- |
| Four-artifact responsibility decomposition | **responsibleArtifact** | A single attribution field, not a classification system |
| harm domain | **impactSurface** | What the friction endangers: `target-repo \| context \| external \| governance-state` |
| attack surface | **entrySurface** | Where the friction entered: `instruction-surface \| tool-output \| policy-rule \| capability-request` (extends F058's instruction-surface vocabulary) |
| failure mode | **failureMode** | Free text, deterministically extracted |
| artifact routing | **attribution proposal** | A proposal carrying the attribution block; Finding-propose-Intent semantics (CONTEXT.md "Finding": a Finding may propose an Intent, never silently create one) |
| bounded editing | existing **maintenance proposal / F064 allowlist** | No new term |
| validity check | **validity rules** (V1–V3) | Deterministic admission checks; three rules (§6) |
| safety–utility selection | **dual-axis assessment** (report) | ADR-0008 readiness vs effectiveness vocabulary; report-only |
| rejection feedback | **rejection record** | Append-only entry in the owning record surface (§8) |
| — | **rejection-history hint** | Deterministic, informative admission-time notice keyed by fingerprint (§8.3) |
| — | **exposure denominator** | The usage base a recurrence count is divided by (§9) |

## 3. Attribution value shape (normative)

One value shape, defined once, referenced by existing consumers. It is a claim about
where a friction is attributed; it is never a permission and never selects an apply
path (the destination owner table in §4 does that).

```json
{
  "findingAttribution": {
    "entrySurface": "instruction-surface | tool-output | policy-rule | capability-request",
    "impactSurface": "target-repo | context | external | governance-state",
    "failureMode": "<string, deterministically extracted>",
    "responsibleArtifact": "instruction-surface | rules | memory | capability-registry | wiki | route | loop-contract"
  }
}
```

- Both surface enums and the `responsibleArtifact` enum are closed sets. Extensions
  require a spec change to this contract, not an implementation-side addition.
- Consumers: the F064 suggestion card (`ImprovementSuggestion`), the maintenance
  proposal object, and the structured evolution Finding (§5 stage 1). Each consumer
  embeds the block beside its own operation/payload fields; none of them becomes the
  other.
- Runtime home: the canonical enums and validator live in one shared module
  (`scripts/lib/core/finding-attribution.js`, proposed) consumed by
  `maintenance-propose.js` directly and by the web suggestion surface through the
  existing `scripts/lib/web-adapter.js` bridge; the TS interface in
  `apps/web/server/lib/suggestions/types.ts` mirrors it with a parity test.

## 4. Destination routing (normative)

Every proposal destination has exactly one owner surface for admission, review, and
apply. "Owner" means: that surface's existing verbs, approval level, ledger, and
recovery semantics apply unchanged. The evolution loop produces proposals that enter
these surfaces; it never adds a parallel apply path.

| Destination | Owner surface (admission → review → apply) | Review level | Apply executor | Anchors |
| --- | --- | --- | --- | --- |
| wiki | F064 card → web `/suggestions` Preview/Apply → F064 Apply (all-or-nothing, content-hash guarded, Undo) | Operator action | F064 Apply (realized; planner emits wiki creates only) | F064 §4–§6; `planner.ts:69-88`; `apply.ts:16-119` |
| memory (`MEMORY.md` / registry entries) | ADR-0018: memory request (state `proposal`) → `ingest` → human `approve` (entry-level, reject requires reason) → **human writes the text** → `book` registers the surface hash | Human (entry-level approve; `approver: human`) | The human; Amber never writes `MEMORY.md`. F064 Apply refuses the path outright | ADR-0018 D5; memory spec §5.4–§5.5; `paths.ts:29-37` (not allowlisted); memory spec §6.1 signal `evolution-recurrence` (existing nomination hook) |
| instruction-surface (AGENTS.md, CLAUDE.md, `skills/*/SKILL.md`) | In-scope destination. F064 Apply allowlist permits these paths, but the current planner emits wiki creates only; the planner extension adding `agents-md`/`skill` operations under the same allowlist is **planned and in scope** (plan slice 6), with the behavior-affecting presentation duties — instruction edits change agent behavior, so proposals must present them as behavior-affecting, not low-risk-by-filename. Wiki remains the default suggestion surface; instruction-surface operations gain explicit governed access through the same F064 review duties plus F058 surfaces (eval non-authority per C3) | Operator action **plus** instruction-surface review duties (F058 surfaces; eval non-authority per C3) | F064 Apply, once the planned planner extension lands (proposed, in scope — not deferred on any evidence condition) | F064 §4; `paths.ts:6,34-36`; F058 |
| rules (rules.json v2) | 0051 v2 rules surface: typed mutation (`--yes`) bound to a committed human Decision | Human Decision | CLI typed mutation; apply changes `policyHash` → F050 staleness propagation invalidates affected approvals | 0051 (policyVersion mismatch → stale; `staleness-registry.js` policy dependency); visible dependency: rules v2 not yet landed |
| capability-registry | F052 registration governance: committed human Decision | Human Decision (committed) | F052 registration path; proposals can never reduce the registry (V2) | F052; AGENTS.md runner registry entry |
| route | Existing route management: typed mutation behind human approval + governance ledger | Human Decision | Route typed mutation | `routes/` + `schemas/route.schema.json`; F062 stage-verb boundary |
| loop-contract | Existing loop management: typed mutation behind human approval + governance ledger | Human Decision | Loop typed mutation; execution stays governed (ADR-0003 four gates) | ADR-0003; `schemas/loop-contract.schema.json` |

Non-reactivation rule: applying a behavior-surface proposal creates a **new**
authorization through its own Decision. Approvals invalidated by the resulting
`policyHash` change are never reactivated by the proposal's similarity to any
previously approved change (0051 staleness reuse; F050 single-use approvals).

## 5. Stage semantics

Four stages. Each row states input, output, owner, allowed action, evidence,
rejection/retry, and retention.

### Stage 1 — Observation (Finding)

| Aspect | Semantics |
| --- | --- |
| Input | Host transcripts (F064 adapters, ceiling-bounded), registered F054 detectors, evolution wiki text (legacy counter), F023 write-back triggers |
| Output | Finding/signal: fingerprint where the source defines one (F064: tool name + normalized first error line; F054: subject + rule version + scope + window), redacted excerpts, and — for structured findings — the §3 attribution block |
| Owner | The detecting surface (suggestions service; maintain detectors). Deterministic, model-independent |
| Allowed action | Read-only detection. No mutation of any target |
| Evidence | Transcript ids / detector version + baseline + window / source file references |
| Rejection/retry | Observations are not rejected; cooldowns and clustering dedupe (F054 cooldown appends evidence; F064 promotes at ≥2 distinct transcripts) |
| Retention | Source-owned. Amber stores redacted excerpts only; raw transcripts stay in host homes and are never copied into Amber state |

### Stage 2 — Proposal

| Aspect | Semantics |
| --- | --- |
| Input | A promoted Finding (F064 cluster; F054 finding; recurrence ≥2 for memory nomination) |
| Output | A proposal object in the **owning** surface: F064 card (web overlay + suggestion-review ledger), memory request (state `proposal`), F054 Trigger Proposal, maintenance proposal (markdown), or a deterministically derived behavior-surface draft (rules/capability/route/loop) |
| Owner | The destination's producer: F064 planner (wiki-only today); host agent under a Distillation Contract for generated knowledge text; deterministic deriver for behavior-surface drafts (§7) |
| Allowed action | Propose only |
| Evidence | ≥1 evidence reference (V1): receipt id, F064 cluster evidence, transcript citation, or inspection reference |
| Rejection/retry | Validity check V1–V3 at admission (§6); failure rejects the proposal before any review, records a rejection record (§8), and returns the reason code. Retry is a new proposal; the rejection-history hint is shown at its admission |
| Retention | Per owning surface: F064 → suggestion-review ledger (§8); memory → `.amber/context/events.jsonl` (closed five-kind set); F054 → `.amber/maintain/`; maintenance → `.amber/maintenance/proposals/` |

### Stage 3 — Review

| Aspect | Semantics |
| --- | --- |
| Input | A validated proposal (V1–V3 passed) |
| Output | Approval (Decision or Apply) or rejection with reason |
| Owner | Human. Knowledge surface: the operator (Preview/Apply/Dismiss/Snooze/Undo on `/suggestions`; memory approve is `approver: human`). Behavior surface: committed human Decision. F054 triage: the declared service owner (`fix\|schedule\|dismiss`) |
| Allowed action | Approve, reject (reason required on memory reject; dismiss preserves reason on F054 and F064), snooze (runtime-only, §8.1), undo (§8) |
| Evidence | Decision records / approval events / suggestion-review ledger events |
| Rejection/retry | Rejection recorded in the owning surface with reason; a retry is a new proposal that sees the rejection-history hint |
| Retention | Ledger discipline (append-only) + F055 classification (C4) |

### Stage 4 — Change (apply)

| Aspect | Semantics |
| --- | --- |
| Input | An approved proposal |
| Output | The applied change plus integrity records: content hashes (F064 applied record: before/after hash + previous bytes for Undo), surface normHash (memory `book`), `policyHash` change (rules) |
| Owner | The destination's apply surface (§4 table) |
| Allowed action | Exactly the destination's bounded mutation — F064 all-or-nothing with stale refusal; human hand for `MEMORY.md`; typed mutation for behavior surfaces |
| Evidence | Applied/`memory-book`/Decision events; changed hashes |
| Rejection/retry | Stale apply refused on content-hash mismatch (never clobbers); Undo restores previous bytes only when the file still matches what Apply wrote; failed admission leaves authorizations unconsumed (F050) |
| Retention | Target file + owning ledger; staleness propagation for policy-bound approvals |

## 6. Validity rules (V1–V3)

Executor: deterministic admission code in each owning surface (the `inputProblem`
shape-check discipline), never a model, never a human. Ordering: V1–V3 run before
human review; only passing proposals enter the review queue.

| Rule | Mechanical check | Reason code |
| --- | --- | --- |
| V1 no-evidence | The proposal carries ≥1 resolvable evidence reference (receipt id, cluster evidence, transcript citation, inspection reference) | `validity:no-evidence` |
| V2 capability-reduction | No declared operation deletes or downgrades a capability-registry entry | `validity:capability-reduction` |
| V3 eval-only-claim | The effect statement is present and is not solely an eval reference; it names both axes (readiness + effectiveness) of the dual-axis assessment | `validity:eval-only-claim` |

Non-claims (normative): passing V1 proves an evidence reference exists, not that the
evidence is true. Passing V3 proves a dual-axis statement is present, not that the
assessment is sound. Semantic judgment belongs to the stage-3 human reviewer. Eval
results — including instruction-surface evals — never authorize policy, capability,
route, or instruction-behavior changes (F058; `eval run` report-only).

## 7. Model-driven generation boundary

Hybrid decision (0057 §5) stands with the C7 corrections:

- **Knowledge text (wiki, instruction-surface bullet text):** a host agent may
  generate proposal text under a Distillation Contract (ADR-0009 topology: Amber
  writes the contract and judges the result; the host executes; **Amber never calls a
  model**). The proposal's `proposed` event carries the generation record:
  `{generator: Principal, modelDeclared: string, promptHash: sha256, distillationContractId: string}`.
- **Memory:** generated candidates materialize as memory requests entering the
  ADR-0018 pipeline with its existing provenance vocabulary; the evolution contract
  adds no memory-side fields. ADR-0018 closed sets (signal set, event kinds,
  provenance channels) change only through that spec's own amendment path.
- **Behavior surfaces (rules / capability-registry / route / loop-contract):**
  generation is deterministic derivation from structured Findings (fingerprint
  clusters, §3 attribution) into declarative templates. Model wording never enters
  behavior-surface language — even with human review downstream, the generation
  injection surface stays closed (ADR-0014: behavior-surface decisions deterministic).
- **Application:** both classes apply only through stage 3 + stage 4 at the
  destination's own approval level. Auto-apply is permanently excluded.

## 8. Rejection records and the `suggestion-review` ledger family

### 8.1 Responsibility and authority split

The F064 overlay (`.amber/suggestions/state.json`, gitignored) is the **persistent
current-state owner** for suggestion card status — `open`/`applied`/`dismissed`,
snooze windows, and the applied byte-records that Undo needs. Persistent here means
exactly what the storage provides: it survives process restarts and ordinary use,
but it is not version-controlled, not tamper-evident, and not an audit trail (its
current reader also returns an empty state on any read failure — existing behavior,
unchanged by this contract and named here rather than silently relied on). The
`suggestion-review` family is the **durable audit trail** for F064 cards — the same
split ADR-0018 D4 draws between event ledger (audit) and registry (state).

Boundary, stated exactly: if the overlay is deleted or corrupted, **review history
survives** in the ledger (`rejected`/`applied`/`undone` events are recoverable and
the rejection-history hint keeps working), but **snooze windows and in-flight card
status are lost** — they are overlay-only state, deliberately not ledger-recorded
(snooze is a wall-clock projection, not a review decision). This contract does not
change that behavior; it makes it explicit. Loss of the overlay therefore never
loses a rejection decision, and never silently rewrites Dismiss/Snooze/Undo into
ledger history they did not have.

### 8.2 Family interface

Declared through `defineLedgerFamily` (`scripts/lib/core/ledger-family.js`, ADR-0028 —
the single admission path; 0045's conclusion: no hand-written chains). One ledger
under `.amber/suggestions/review.jsonl`. Closed event-kind set of five:

| Kind | Payload (beyond family chain fields) | Written by |
| --- | --- | --- |
| `proposed` | fingerprint, evidence digest, hosts, planned-operations digest, attribution block, generation record when host-generated | Card promotion |
| `validated` | fingerprint, V1–V3 pass summary — the fingerprint closes the correlation chain `proposed → validated → (rejected \| applied)` | Admission validator |
| `rejected` | fingerprint, reason (`validity:*` code or operator dismiss reason), redacted evaluation summary | Admission validator or operator Dismiss |
| `applied` | fingerprint, applied record digest (paths, before/after hashes) | Apply success |
| `undone` | fingerprint, restored-hashes digest | Undo success |

### 8.3 Rejection-history hint

At card admission, the fold over `suggestion-review` is queried by fingerprint. A
prior `rejected` event yields a deterministic, **informative** notice ("this
fingerprint was previously rejected for X") — it never blocks admission (the scenario
may have changed). When the ledger is missing, unreadable, or fails its chain walk,
the notice reports the history as **unknown** — never as "no prior rejection"
(unknown ≠ empty, F055 discipline).

### 8.4 Retention

Records carry minimal provenance — fingerprint, reason code, redacted summary — never
raw transcripts or unredacted excerpts. The ledger is append-only as a mutation
discipline (C4); retention classification, TTL, legal basis, and any deletion
candidate belong to F055 and the tenant retention Policy through their own governed
process, with the retention owner named there. The evolution surface neither deletes
nor unilaterally declares permanence.

### 8.5 Other surfaces: per-destination rejection records (correlation closed)

No second proposal authority and no new ledgers outside the F064 `suggestion-review`
family. Every destination's validity/human rejection still produces a durable record
in an owning surface, with a named correlation key and a named lookup. "Owner exists"
is not the claim — the mapping is:

| Destination | Rejection record (producer → record) | Correlation key | Lookup |
| --- | --- | --- | --- |
| F064 card | `suggestion-review` `rejected` event (§8.2) | card fingerprint | ledger fold; admission-time hint (§8.3) |
| memory | `memory-approval` reject event (reason mandatory) + entry `lastRejection` | memory entry / request id | ADR-0018 pipeline reads |
| maintenance proposal | validity failure no longer "writes nothing": `proposeMaintenance` records the rejection **in the proposal record itself** (a `## Rejection` section: reason code, timestamp, redacted summary) so the durable proposal file carries its own rejection history | canonical hash of the §3 attribution block (maintenance has no native fingerprint; the attribution block is this contract's deterministic key) | the proposal file in `.amber/maintenance/proposals/` |
| F054 finding/triage | maintain triage ledger dismissal (reason preserved) | F054 finding fingerprint (subject + rule version + scope + window) | maintain ledger fold |
| rules (0051 surface) | the typed-mutation surface must record a refused/validated-failed submission as its own record — **not** only the F050 policy outcome (a proposal can be rejected at validity or human review with no policy evaluation running). Required fields: attribution fingerprint, reason code, timestamp, redacted summary. Exact record shape is 0051's owner decision (open dependency, plan slice 5) | attribution fingerprint | the 0051 surface's own read |
| capability-registry (F052) | same contract: the F052 surface records the refused proposal distinct from registration events; exact shape is F052 owner decision (open dependency) | attribution fingerprint | F052 registry reads |
| route / loop-contract | same contract on their typed-mutation surfaces; exact shape is the owning ticket's decision (open dependency) | attribution fingerprint | the owning surface's reads |

Policy-evaluation denial (F050 policy outcome, `policyHash` staleness) is a
consumption-time fact and is **not** the synonym of proposal rejection; both may
occur independently and both are recorded by their own owners.

### 8.6 Governed writes: precheck → commit → compensation (audit is never optional)

The §8.3 hint and E7 govern the **read side only** (the history lookup may degrade
to `unknown`). The write side has no such degradation: `proposed`, `validated`,
`rejected`, `applied`, and `undone` are mandatory governed writes, and a corrupt,
locked, or ceiling-exhausted ledger must never turn into "mutation succeeded, audit
silently missing". Ordering for every state-changing F064 mutation (Apply shown;
Undo/Dismiss/promotion follow the same shape):

1. **Precheck (before any mutation):** walk the ledger chain, probe appendability
   (lock/ceiling), and validate target state (allowlist, content hash). Failure ⇒
   refuse — no file, overlay, or ledger change.
2. **Commit:** perform the target mutation (existing all-or-nothing file writes,
   `apply.ts:100-115`), then append the audit event, then update the overlay. The
   overlay's `applied` status is written **only after** the audit append succeeds —
   a missing audit event can never present as success.
3. **Failure or compensation:** an audit-append failure after the file mutation
   triggers byte-restore compensation (the existing `rollback`/`previousContents`
   machinery, `apply.ts:104-110,150-160`) and returns an explicit
   `audit-write-failed` error; if compensation itself fails, the error names the
   degraded state (file mutated, audit missing) and the operator reconciliation
   step — it is never reported as success and never silently retried.

On any refusal path, files and overlay show no unexplained successful change; this
ordering and its failure states are test obligations (plan slice 3).

## 9. Recurrence measurement

- Recurrence is a **rate**: fingerprint occurrences divided by an exposure denominator
  (transcripts scanned in the window, sessions, or the F054 declared window). Sources:
  F064 cluster evidence (`transcriptCount` over scanned transcripts), F025 break-loop
  recurrence, F054 windowed findings, and the memory signal `evolution-recurrence`.
- Before/after comparisons for an applied proposal must use comparable exposure; a
  count drop from lower usage is not improvement and must not be reported as such.
- When the denominator is unavailable or unknown, the report states `unknown`; no
  improvement metric is fabricated.
- Findings feed the dual-axis assessment (ADR-0008 readiness + effectiveness) as
  report-only input. Automatic safety–utility selection stays rejected (0048).

## 10. Invariants

| # | Invariant |
| --- | --- |
| E1 | Attribution is a claim, never a permission. Target-file category never implies apply permission; routing is resolved only through the §4 owner table. |
| E2 | One attribution shape (§3) referenced by existing consumers. Suggestions, Maintenance Proposals, and canonical Intents remain distinct objects; no merged proposal authority exists. |
| E3 | Every destination has exactly one owner surface for admission, review, and apply. `MEMORY.md`'s owner is the ADR-0018 pipeline; F064 Apply refuses it. |
| E4 | No auto-apply; no Amber-invoked model; no eval-authorized behavior change. Application is human-gated at the destination's own level. |
| E5 | V1–V3 prove form, never semantic truth; the human reviewer is the semantic judge. |
| E6 | Rejection records are append-only as mutation discipline; retention is F055-owned; records carry minimal redacted provenance. |
| E7 | The rejection-history hint is informative and governs the **read side only**: unavailable history reports unknown, never "no prior rejection", and never blocks admission. Write-side degradation is forbidden (E12). |
| E8 | Recurrence claims carry a comparable exposure denominator or report unknown. |
| E9 | Behavior-surface changes preserve their own Decision requirements and invalidation; prior authorization is never reactivated. |
| E10 | Model-generated knowledge text arises only through host generation under a Distillation Contract with a recorded generation record; behavior-surface proposals are deterministically derived. |
| E11 | The F064 planner extension to instruction-surface operations is **in scope and planned** (implementation plan slice 6) under the existing allowlist, carrying the behavior-affecting presentation duties; wiki remains the default suggestion surface. No implementation is deferred on a recurrence-benefit evidence condition — recurrence reporting stays report-only (E8) and never gates scope. Until the extension lands, the planner is honestly described as wiki-only. |
| E12 | The §8.2 audit events are mandatory governed writes: ledger corruption, lock, or ceiling on the write path refuses the mutation (§8.6 precheck/commit/compensation) — an audit write never degrades to a hint, and a mutation never reports success without its audit event. |

## 11. Error codes

- Validity reason codes (closed set, §6): `validity:no-evidence`,
  `validity:capability-reduction`, `validity:eval-only-claim`.
- F064 Apply refusals are unchanged (`already-applied`, `dismissed`, `stale`,
  `not-applied`, `not-allowlisted` — `apply.ts`), plus one new explicit failure
  code for the §8.6 write path: `audit-write-failed` (audit append failed after
  mutation; compensation attempted; never silent success).
- The `suggestion-review` family inherits the shared ledger failure codes
  (corrupt-code plumbing, chain-walk refusals, ceiling) from the
  `defineLedgerFamily` declaration; admission-shape failures use the family's
  `inputProblem` discipline (F061).
- No new `AMBER_E_MEMORY_*` codes: the memory path changes nothing in ADR-0018's
  error family.

## 12. Compatibility and non-goals

- F064's existing behavior is unchanged except for additive fields (attribution,
  dual-axis effect statement), the new durable review trail, and the §8.6 write
  ordering. The overlay keeps its schema and remains the persistent current-state
  owner (status, snooze, applied byte-records) with the §8.1 boundary: review
  history is ledger-recoverable, snooze and in-flight status are overlay-only and
  lost on overlay deletion; existing state files need no migration.
- Legacy evolution text counting (`evolution-findings.js`) keeps its output shape;
  structured findings are additive.
- No new default CLI verb, no MCP Action, no `amber next` change (F064 boundary
  reaffirmed; ADR-0014).
- Non-goals: auto-apply, Amber-invoked models, scheduled analysis, cross-repo
  scanning, writing tests/product code/CI through any proposal path, and any
  permanent-retention claim made by this contract.

## 13. Source map (producer → consumer anchors)

| Claim in this contract | Anchor |
| --- | --- |
| F064 Apply allowlist; `MEMORY.md` refused | `apps/web/server/lib/suggestions/paths.ts:6,29-37`; F064 spec §6 |
| Planner emits wiki creates only; AGENTS.md bullet is body text | `apps/web/server/lib/suggestions/planner.ts:69-88`; F064 spec §4 |
| Apply all-or-nothing, stale refusal, Undo | `apps/web/server/lib/suggestions/apply.ts:16-165`; F064 spec §6 |
| Overlay is gitignored runtime state | `apps/web/server/lib/suggestions/store.ts:39-47`; F064 §5 |
| Memory pipeline: ingest → approve → human write → book; Amber never writes the file | `docs/adr/0018-governed-memory-layer.md` D5; `docs/specs/2026-08-21-governed-memory-layer.md` §5.4–§5.5 |
| Memory event set closed at five kinds | ADR-0018 D4 |
| Memory rejection reason mandatory; `lastRejection` | memory spec §5.4 (A2/A4) |
| `evolution-recurrence` nomination signal exists | memory spec §6.1 signal #5 |
| F054: findings/proposals/triage ledgers; dismiss preserves reason; detector fingerprints | `docs/specs/F054-deterministic-maintain-intent-reentry.md`; AGENTS.md maintain entry |
| F055: retention classes, TTL from tenant Policy, deletion proof, unknown ≠ empty | `docs/specs/F055-retention-coordinated-deletion-proof.md` |
| policyHash change → staleness; approval policyVersion mismatch → stale | `issues/0051-pdp-policy-model-approval-binding.md` (staleness reuse; `staleness-registry.js` policy dependency) |
| Capability registration behind committed human Decision | F052; AGENTS.md runner registry entry |
| Ledger families declared via `defineLedgerFamily` only | `docs/specs/F061-ledger-family-factory.md`; ADR-0028; `scripts/lib/core/ledger-family.js:1-20` |
| Finding may propose an Intent, never silently create one | `CONTEXT.md` "Finding" |
| Distillation Contract topology; Amber never calls a model | `CONTEXT.md` "Distillation Contract"; ADR-0009 |
| Evolution loop gap: no attribution fields, no validity rules, no rejection records | `issues/0045-harness-v3-gap-ledger.md` (2026-09-15 table) |
| Text counting today | `scripts/lib/core/evolution-findings.js:21-39` |
| Maintenance proposal object + markdown output | `scripts/lib/core/maintenance-propose.js:16-86,91-168` |
