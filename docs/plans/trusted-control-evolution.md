# Plan: Trusted Control Evolution Contract implementation

Spec: `docs/specs/trusted-control-evolution-contract.md` (spec_id `trusted-control-evolution-contract`, status `proposed`, updated 2026-09-16)
Status: proposed — **pending coordinator re-review; implementation NOT started**
Origin tickets: `issues/0048-trajectory-attribution-adoption-boundary.md`, `issues/0057-evolution-proposal-evidence-contract.md` (corrections appended 2026-09-16, both pending coordinator review)
Baseline HEAD: `0a9cbeab85898bd043e1ab9f7c89ea71193cbb78`
No new F-number is introduced; F064 remains the feature owner of the suggestion surface; the feature catalog is untouched by this packet.

## Goal

Implement the evolution contract end to end: the shared `findingAttribution` shape on
the F064 card and the maintenance proposal; deterministic V1–V3 admission checks with
closed reason codes; the scoped `suggestion-review` ledger family (five kinds,
`defineLedgerFamily`) as the durable F064 review trail with the informative
fingerprint-keyed rejection-history hint (unknown ≠ empty); the dual-axis effect
statement on planned operations; and structured evolution findings — while every
destination keeps its existing owner (memory stays on the ADR-0018 pipeline; rules,
capability, route, loop stay on their Decision-bound typed mutations), with no new
CLI verb, no MCP Action, and no `amber next` change.

## High Level Design

- **Context:** audit P1-07 (MEMORY.md would bypass its content authority if folded
  into F064 Apply) and the O4 recommendation (shared attribution, existing owner
  paths, no one-click-everything, defer target-surface extension). The canonical
  contract now lives in the spec; this plan turns it into tracer-bullet slices. The
  routing correction means several decided destinations need **zero new code** — their
  owner surfaces already exist and are named in the spec §4 table.
- **No second authority:** the only new state is the `suggestion-review` ledger
  (`.amber/suggestions/review.jsonl`), justified in spec §8.1: the F064 overlay is
  gitignored runtime state that cannot carry durable rejection history. The overlay
  keeps its schema and remains the state authority; the ledger is the audit trail
  (the ADR-0018 D4 split).
- **Memory path = routing only:** a memory-destination proposal materializes as a
  memory request on the existing pipeline; the `evolution-recurrence` nomination
  signal already exists (memory spec §6.1 #5). No memory code changes.

## Slices (tracer-bullet order; each lands green with tests)

### Slice 1 — Shared attribution module + two consumers

- New `scripts/lib/core/finding-attribution.js`: the closed enums
  (`entrySurface`, `impactSurface`, `responsibleArtifact`) and
  `attributionProblem(value)` validator. Pure, CommonJS, no fs.
- `scripts/lib/core/maintenance-propose.js`: embed the block in the proposal
  content (an `## Attribution` section rendered from the block) and in the returned
  inspection envelope; admission refuses a proposal whose attribution block fails
  validation (existing `errors` array pattern).
- `apps/web/server/lib/suggestions/types.ts`: mirror
  `FindingAttribution` (optional field on `ImprovementSuggestion`).
- `apps/web/server/lib/suggestions/planner.ts`: populate the block
  deterministically from the cluster (`entrySurface: "tool-output"`,
  `impactSurface` from target class, `failureMode` = normalized first error line,
  `responsibleArtifact: "wiki"` for the planned note).
- Parity test asserting the TS interface matches the CommonJS enums
  (same pattern as the command-registry parity tests).

**Progress (2026-09-16, B1): delivered.** `finding-attribution.js` live (frozen
enums, closed field set, repo-style problem strings); maintenance carrier
validates a supplied block before any write (`attributionStatus:
validated | legacy-unattributed`, malformed ⇒ errors, nothing written; legacy
output byte-identical); F064 cards carry a seam-validated block derived in
`planner.ts` (`deriveFindingAttribution`) and attached in `cluster.ts` through
the web-adapter bridge (`attributionProblem` + frozen `FINDING_ATTRIBUTION`
projection; no `.d.ts` change needed — inline cast like knowledge-graph-reader).
Evidence: node 84/84 (new `finding-attribution`/`maintenance-attribution` + all
affected web-adapter/maintenance suites), vitest 17/17 (new
`suggestions-attribution` + cluster/security), `npm run typecheck` clean —
`.scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4/results/B1-checks.log`.
**B1R (same day): independent review findings repaired** — own-fields
requirement (inherited-only carriers rejected), explicit-null is invalid (never
a legacy path), invalid derived/rendered blocks are explicit errors at the real
boundaries (no silent downgrade), `displayFailureMode` redacts secrets BEFORE
normalization (fingerprint identity unchanged), credential-bearing failureMode
refused with a non-leaking reason, multiline failureMode renders as a Markdown
blockquote, `web-adapter.d.ts` is the typed SSOT consumed by `cluster.ts`, and
the TS/runtime parity is compiler-enforced in both directions. Full gates:
root 3611/3611, apps/web 759/759, manifests/doctor/gen:agents:check/typecheck
green — `results/B1R-gates.log`.
Not in this slice (unchanged scope): upstream attribution producers for
maintenance inspections, the suggestion-review ledger (Slice 3), derivers
(Slice 5), planner extension (Slice 6).

### Slice 2 — Validity admission checks (V1–V3)

- F064: in the card-promotion/admission path (service layer), check V1 (cluster
  evidence present), V2 (no operation targets capability-registry paths — trivially
  true under the allowlist; assert it), V3 (planned operations carry a dual-axis
  `expectedEffect` statement — planner template gains a structured field, not prose
  only). Failures reject the card before `/suggestions` exposure with the
  `validity:*` reason codes.
- Maintenance: same three checks in `proposeMaintenance` admission. A validity
  failure is **not** "write nothing": the proposal record is written with a
  `## Rejection` section (reason code, timestamp, redacted summary), so the durable
  proposal file carries its own rejection history; the correlation key is the
  canonical hash of the attribution block (spec §8.5). Retry sees the prior
  rejection in the file.
- `evolution-findings.js`: keep the text counter's output shape; add
  `extractStructuredFindings` emitting the attribution block per recurring finding
  (additive; `significantEvolutionFindings` untouched).

**Progress (2026-09-16, B2M): delivered for the maintenance path.** The shared
invariant lives once in `scripts/lib/core/evolution-validity.js`
(`validateEvolutionAdmission`, closed reason codes `validity:no-evidence` /
`validity:capability-reduction` / `validity:eval-only-claim`, V1→V2→V3
first-failure ordering): V1 resolves EVERY evidence reference against its owning
source (bounded existing path with optional in-range line, via
`resolvePathWithin`; or an Evidence receipt id via the receipt ledger
fold) — an invented or unresolvable citation never passes; V2 refuses declared
remove/update on the capability-registry surface with alias-proof
(separator-, `./`-, `..`-, and case-folded) path comparison and fails unknown
operation shapes rather than passing them as safe; V3 requires both
readiness AND effectiveness statements, each not solely an eval reference
(unicode-aware deterministic detector). The maintenance producer is wired for
real: `amber-finding` fenced JSON blocks in `harness-evolution.md` are extracted
by `extractStructuredFindings` (block interiors are data — the legacy counter
skips them; legacy APIs and shapes unchanged), the evidence facade lifts a
single distinct significant attribution into the inspection carrier
(multiple distinct attributions stay unattributed with a visible warning —
never collapsed), and `proposeMaintenance` runs admission on the carrier: a
valid proposal renders `## Evidence` + `## Expected Effect` beside B1's
`## Attribution`; a validity failure writes the owning record with a durable
`## Rejection` section (reason code, timestamp, non-echoing redacted summary,
canonical correlation hash) whose retry finds prior rejections by correlation
(unreadable records report history unknown, never empty); malformed or
secret-bearing external attribution refuses at pre-admission with nothing
written; failed record persistence is an explicit refusal. Legacy observations
stay explicitly legacy (no own carrier key, `validity: null`). Evidence: node
45/45 new suites + 106/106 affected suites, full root/manifests/doctor/
gen:agents:check gates — `results/B2M.md` + `results/B2M-root-npm-test.log`.
**Not in this slice (unchanged scope):** the F064 card-admission path
consuming the same invariant, the `suggestion-review` ledger (Slice 3),
recurrence reporting (Slice 4), derivers (Slice 5), planner extension
(Slice 6). F064 service admission and its mandatory rejection ledger are a
separate dependent packet by design.

### Slice 3 — `suggestion-review` ledger family

- New `scripts/lib/core/ledger-suggestion-review.js` (or a declaration table inside
  the suggestions state seam — implementation choice): `defineLedgerFamily` with one
  ledger, `review.jsonl`, closed kinds `proposed|validated|rejected|applied|undone`,
  payloads per spec §8.2 — **including the fingerprint on `validated`** (closes the
  `proposed → validated → …` correlation chain). No hand-written chain code
  (ADR-0028; 0045 conclusion).
- Expose append/fold through `scripts/lib/web-adapter.js`; the web suggestion
  service calls it via the existing `requireCli` bridge.
- Web mutations wire the events: promotion → `proposed`; admission pass →
  `validated`; validity failure or operator Dismiss → `rejected` (reason code or
  dismiss reason, redacted summary); Apply success → `applied` (applied-record
  digest); Undo success → `undone`. Snooze stays overlay-only (spec §8.1).
- **Write ordering per spec §8.6 (precheck → commit → compensation):** before any
  Apply/Undo/Dismiss mutation, precheck the ledger (chain walk + append probe +
  target validation) and refuse with nothing changed on failure; commit order is
  target mutation → audit append → overlay update, with the overlay `applied`
  status written only after the audit append succeeds; an audit-append failure
  after mutation triggers byte-restore compensation and returns the explicit
  `audit-write-failed` error (compensation failure names the degraded state,
  never success).
- Admission-time hint: fold the ledger by fingerprint; prior `rejected` →
  informative notice; unreadable/corrupt/missing ledger → notice says history
  **unknown** (never "no prior rejection"); the hint never blocks (read side only,
  spec E7/E12 split).

**Progress (2026-09-17, B3): delivered.** `scripts/lib/core/ledger-suggestion-review.js`
declares the family through `defineLedgerFamily` only (one ledger,
`.amber/suggestions/review.jsonl`, closed five-kind set; `validated` carries the
fingerprint, closing `proposed → validated → (rejected | applied)` plus `undone`).
The whole surface is exposed through `scripts/lib/web-adapter.js` + its `.d.ts`
(append/fold/precheck/history/frozen vocabulary) and reached from
`apps/web/server/lib/suggestions/**` through the existing `requireCli` bridge —
no deep `scripts/lib` import from `apps/web`. The real card lifecycle is wired:
promotion → `proposed`, admission pass → `validated`, validity failure or operator
Dismiss → `rejected` (closed `validity:*` code or the operator dismiss marker, with
a redacted summary), Apply success → `applied` (applied-record digest), Undo success
→ `undone` (restored-hashes digest); Snooze stays overlay-only. Admission consumes
the shared `validateEvolutionAdmission` invariant for V1 cluster evidence, V2
capability-registry protection, and V3 dual-axis effect; an invalid card is never
exposed through `/suggestions` while its rejection stays durable. The §8.6 ordering
(precheck → target mutation → mandatory audit append → overlay) is implemented for
Apply, Undo, and Dismiss, with byte-restore compensation and the explicit
`audit-write-failed` code (compensation failure names the degraded state and the
operator reconciliation step). Evidence: root 3666 tests (4 pre-existing
parallel-session failures, none from this slice), apps/web full Vitest, focused
suites, typecheck — `results/B3.md` + `results/B3-*.log`.
**Not in this slice (unchanged scope):** recurrence reporting (Slice 4),
behavior-surface derivers (Slice 5), instruction-surface planner extension
(Slice 6).

### Slice 4 — Recurrence reporting (report-only)

- F064 list/read output gains `recurrenceRate` = occurrences / transcripts scanned
  for the same window; when the denominator is 0 or unavailable, the field reports
  `unknown` (not a number). No before/after improvement claim is computed anywhere;
  dual-axis text is carried, not scored.

**Progress (2026-09-18, B4): delivered.**
`scripts/lib/core/recurrence.js` derives one window's evidence
(`occurrences`, `transcriptsScanned`, `recurrenceRate`, closed
`denominator: measured|unknown`, `window`) — the rate is `null` (reported as
`unknown`) whenever the denominator is absent, non-finite, or zero, and the
derivation computes no comparison of any kind. Exposed through the
`web-adapter.js` seam (`deriveRecurrence`, `transcriptWindowLabel`, frozen
`RECURRENCE` projection) and typed in `web-adapter.d.ts`. The F064 card gains
the additive `recurrence` field: `hosts.ts` now reports the transcripts its
scan actually read (per host, summed — every opened file counts, failing or
not) and `cluster.ts` derives the evidence beside attribution/expectedEffect
from that same window. The maintenance inspection gains the same shape on
`inspection.recurrence` via `maintenance/internal/evidence.js`, with the
evolution log's own window as denominator (legacy `Finding:` lines + structured
blocks; absent log ⇒ `unknown`) and occurrences counted over that SAME window —
legacy lines plus every block whose JSON yields a failure-mode text (a block
that parses to no failure mode stays denominator-only; B4 follow-up fixed the
structured-only occurrence undercount). No improvement claim, no CLI verb, no MCP
Action, no `amber next` change; slice 3 ledger semantics untouched. Evidence:
`results/B4.md` + `results/B4-*.log`.

### Slice 5 — Behavior-surface deterministic derivers (all four destinations)

- One deriver seam producing declarative drafts per destination from structured
  findings (fingerprint cluster ≥N + attribution with the matching
  `responsibleArtifact`): **rules** (rules.json v2 rule drafts — **blocked on 0051
  rules v2 landing**, visible dependency), **capability-registry** (registration
  request drafts for the F052 surface — never registry-reducing, V2), **route**
  (route-definition drafts for the route typed-mutation surface), and
  **loop-contract** (contract drafts for the loop typed-mutation surface). The
  rules deriver writes no rules; every draft enters its owner's Decision-bound
  typed-mutation surface. Each destination also gets its §8.5 rejection-record
  wiring (attribution fingerprint, reason code, timestamp, redacted summary) as
  the owner's record shape allows — rules is 0051-gated; capability/route/loop
  rejection records ride their existing typed-mutation/Decision ledgers where
  present, and the exact record shape for any surface lacking one today is a
  named open dependency, not a silent gap.
- Tests: per-destination determinism (same findings → same draft), draft-only
  (deriver never mutates a target), and the rejection-record correlation round-trip.

**Progress (2026-09-18, B5): delivered for the three unblocked destinations.**
`scripts/lib/core/evolution-derivers.js` is the one deterministic deriver seam
(`deriveEvolutionDrafts(destination, findings, { targetRoot, minCluster })`;
pure — no fs writes anywhere). It consumes `extractStructuredFindings`-shaped
findings, keeps only `count ≥ N` (N defaults to `EVOLUTION_FINDING_MIN_COUNT`)
with `responsibleArtifact` matching the destination, runs the shared V1–V3
invariant per finding, and emits a declarative draft per admitted finding:
capability-registry → `registration-request-draft` (F052
`registerRunner`/`registerRunnerCapability` input skeletons with explicit
nulls — the owner completes them through its human-Decision typed mutation;
never registry-reducing, V2 refuses such findings with
`validity:capability-reduction`), route → `route-definition-draft`
(schema-shaped `routes/` skeleton, deterministic `routeId` slug), loop-contract
→ `loop-contract-draft` (`trigger: manual, enabled: false` — a draft never
schedules). Drafts are free of wall-clock and randomness; same findings in the
same or any order → identical output (order-independent sort by attribution
fingerprint + failure mode). Each draft/refusal carries the correlation key
`attributionFingerprint` = canonical hash of the §3 attribution block (the
same discipline as the maintenance correlation). The rules deriver is NOT
implemented and never invoked: `RULES_DERIVER_BLOCK` is a visible blocked
dependency on 0051 rules v2 (plan open dependency #1), and
`deriveEvolutionDrafts("rules", …)` returns only that block.

**Rejection-record survey (deviation from the "correlation round-trip" test
bullet, justified):** verified against HEAD, **none** of the three surfaces has
a proposal-refusal record shape today — F052's `denied` events cover execution
requests only (distinct from registration proposals, as §8.5 already states);
the route stage ledger records `approved`/`executed` only; the loop ledger
records approvals/executions only. There is therefore no existing record path
to wire and no round-trip to test. Per the slice contract the exact missing
shape is defined and named per surface in `REJECTION_RECORD_DEPENDENCIES` (each
naming its frozen record kind, the four required correlation fields
`attributionFingerprint, reasonCode, recordedAt, summary` =
`REJECTION_RECORD_FIELDS`, its owning ledger path, and its owner ticket) — an
open dependency, not silently invented persistence. Deriver refusals stay
in-memory with exactly the correlation set (fingerprint, reason code,
non-echoing summary, cluster count) and no fabricated timestamp.

**Not in this slice (unchanged scope):** rules deriver (0051-gated), any
consumer wiring (no new CLI verb, no MCP Action, no `amber next` change — the
seam is library-only until an owning ticket wires it), durable rejection
records (open dependencies above), planner extension (Slice 6). Evidence:
node 18/18 new `evolution-derivers` + 112/112 evolution-family suites,
manifests/doctor/gen:agents:check/typecheck/targeted ESLint green —
`results/B5.md` + `results/B5-*.log`.

### Slice 6 — Instruction-surface planner extension (in scope, no evidence gate)

- Adds `agents-md`/`skill` operations to the F064 planner under the existing
  allowlist (F064 §4's declared revision), with the behavior-affecting
  presentation duties (spec §4 row 3) and the F058 review-surface duties. This is
  in-scope planned work with no recurrence-benefit precondition (spec E11); wiki
  remains the default suggestion surface. Tests: planner emits instruction-surface
  operations with behavior-affecting presentation; Apply allowlist accepts them;
  MEMORY.md stays refused.

**Progress (2026-09-18, B6): delivered.**
`apps/web/server/lib/suggestions/planner.ts` gains the two deterministic
instruction-surface operations and a composed card plan
(`planFrictionCardOperations` = wiki note first + `planAgentsMdOperation` +
`planSkillOperation`), and `cluster.ts` emits that full plan on every promoted
card (the previously unused `repoRoot` parameter is now consumed to pin
AGENTS.md's draft-time hash). `planAgentsMdOperation` appends the suggested
bullet to `AGENTS.md` as a hash-pinned `update` (a `create` with the bullet
when the file is absent; loud refusal when the allowlisted path does not
resolve safely, e.g. a symlinked escape); `planSkillOperation` creates
`skills/agent-friction-<fingerprint-slug>/SKILL.md` teaching the same durable
rule. Both carry the behavior-affecting presentation duty in their summaries
(behavior change stated explicitly, human review at Apply named, F058
eval-non-authority boundary stated — never a low-risk-by-filename framing);
contents reference the wiki note and sanitized tool names, never raw error
material. Admission is unchanged: the operations ride the same V1–V3 invariant
(V2 sees only create/update on non-registry paths) and Apply accepts them under
the untouched allowlist with all §8.6 ordering, Undo byte-restore, and ledger
semantics intact; MEMORY.md stays refused and wiki stays the first operation
and the default suggestion surface. No recurrence-benefit precondition, no new
CLI verb / MCP Action / schema change / eval claim. Evidence: new
`suggestions-instruction-surface` suite (8/8) + all seven suggestion suites
55/55 green, root typecheck/manifests/doctor/gen:agents:check green, targeted
ESLint clean — `results/B6.md` + `results/B6-*.log`.

## Compatibility

- Overlay schema and semantics unchanged; existing `.amber/suggestions/state.json`
  needs no migration; the new ledger is created on first append.
- F064 Apply refusals, statuses, snooze windows, Undo byte-restore unchanged.
- `evolution-findings.js` consumers (`maintenance.js`, maintenance evidence facade)
  keep their current API; structured findings are additive.
- No schema file changes (the attribution block is validated in code; no consumer
  stores it in a schema-validated JSON document today). If a later slice moves the
  block into a schema-validated artifact, the schema goes through
  `scripts/lib/core/schema-contract.js` per repo rule.
- No new CLI verb, no MCP Action, no `amber next` change, no change to ADR-0018's
  closed sets.

## Tests

- Unit: attribution validator (closed sets, malformed blocks); V1–V3 reason codes on
  both consumers; maintenance validity failure writes the `## Rejection` section
  (correlation = attribution-block canonical hash); deriver determinism for all four
  behavior-surface destinations (slice 5; rules when unblocked).
- Ledger: family admission/fold via the factory contract (chain walk, ceiling,
  corrupt-code refusal); five-kind closed set; fingerprint present on `validated`;
  hint unknown-on-corrupt (fail-closed read surfaces as unknown history, never
  empty).
- Write-ordering (spec §8.6): precheck failure leaves file/overlay/ledger
  untouched; audit-append failure after mutation compensates via byte-restore and
  returns `audit-write-failed`; overlay never shows `applied` without its audit
  event; compensation failure surfaces the degraded state, never success.
- Web unit: planner emits attribution + dual-axis effect; apply/undo append
  `applied`/`undone`; dismiss appends `rejected`; snooze appends nothing.
- Router tests: list/read pass-through with the new additive fields.
- Playwright: card render with the hint notice when a prior rejection exists.
- Parity: TS `FindingAttribution` ↔ CommonJS enums.

## Producer → consumer trace

| Producer | Consumer | Path |
| --- | --- | --- |
| F064 cluster (fingerprint) | Card `findingAttribution` + dual-axis effect | `cluster.ts` → `planner.ts` → `types.ts` |
| Card promotion | `proposed`/`validated`/`rejected` events | service → web-adapter → `ledger-suggestion-review` |
| Apply / Undo | `applied`/`undone` events | `apply.ts` → web-adapter → ledger |
| Ledger fold | Rejection-history hint at admission | ledger fold → service admission |
| Maintenance inspection | Proposal attribution + V1–V3 | `maintenance.js` → `maintenance-propose.js` |
| Structured findings | Memory nomination signal (existing) | `evolution-findings.js` → memory spec §6.1 `evolution-recurrence` (no code change) |
| Structured findings (rules-attributed) | Rules v2 draft (slice 5) | deriver → 0051 typed mutation (Decision-gated) |

## Open dependencies (visible to the tracker, not resolved here)

1. **0051 rules v2** not landed → the rules deriver in slice 5 is blocked;
   capability/route/loop derivers are not blocked by it.
2. **Rejection-record shapes on 0051/F052/route/loop surfaces** (spec §8.5): each
   owner decides the exact record shape; this contract requires the field set
   (attribution fingerprint, reason code, timestamp, redacted summary) and the
   lookup. Named per-surface, not silently absorbed.
3. **SOURCE-V31** (V3.1 FINAL text absent) — does not block this contract (all
   rules here trace to local explicit decisions and HEAD sources), recorded per the
   goal packet.
