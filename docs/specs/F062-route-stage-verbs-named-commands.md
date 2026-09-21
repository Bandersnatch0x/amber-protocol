# F062: Route Stage Verbs & Named Governed Commands

**Spec ID:** F062
**Status:** Proposed
**Updated:** 2026-09-02
**Provenance:** `issues/0025-amber-native-stage-orchestration.md` and
[ADR-0029](../adr/0029-named-governed-commands-and-stage-verbs.md), reconciled against the
measured repository baseline on 2026-09-02.
**Depends on:** F052 (controlled Runner & capability registry), F056 (registered external side
effects), F050 (Decisions, Gates, Evidence assurance), ADR-0003 (the four governed-execution
gates), ADR-0029 (decision record), ADR-0012 (schema growth and drift signalling)
**Wayfinder record:** `issues/0025` map — seven tickets adjudicated 2026-09-01/02
(0026, 0028–0033), each closed against measured repository state rather than design intent.

## Problem Statement

A route can describe a journey it cannot advance. `amber route test <route> --execute` accepts
only `command` stages; `route-commands.js:160-161` refuses every other type with *"Only command
stages can be executed"*. The `skill` stage — the type most journeys are written in — declares
work and performs none of it, so the declared pipeline and the executable pipeline are two
different pipelines. There is also no verb that advances a route by one stage: `route test` is a
dry run and `session continue` resumes without executing.

A second, narrower problem sits underneath. `runGovernedCommand` takes command **text**
(`governed-runner.js:146-154`), while the runner registry's header states the opposite rule:
*"there is no command field anywhere, so callers can never smuggle shell text through the
registry"* (ADR-0022). Two neighbouring governed surfaces disagree about whether a caller may
hand Amber a command. A route stage carrying command text would settle that disagreement the
wrong way.

The 0025 map initially proposed a Work Runtime layer, a Stage Verb registry, and a Provider
abstraction. Measurement rejected all three: F052 already registers versioned executor identities
with closed capabilities, F056 already governs external effects, `governed-runner.js` already
implements the four gates, and `session` already owns the cursor. Across five gap-check tickets
the confirmed-missing count was five items, none of them structural.

## Solution

Four changes, no new subsystems.

1. **`verb` stage type.** `schemas/route.schema.json` gains `"verb"` in the stage `type` enum. A
   `verb` stage's `target` names a registered F052 capability. Amber gains no new registry.
2. **Named governed commands.** `governed-runner` resolves a `commandId` against
   `.amber/governance/rules.json` instead of accepting command text. The command lives only in a
   human-reviewed policy file.
3. **`session run` / `session settle`.** Two verbs on the existing `session` command advance the
   cursor by one stage and record a host-agent result. No new top-level command, no Work Item
   object, no second cursor.
4. **Audit completion.** The executed ledger record carries `matchedRule`; the run produces an
   Evidence receipt carrying an output digest.

## User Stories

1. As a route author, I want a stage that names a registered capability, so that the journey I
   declare is the journey Amber can actually advance.
2. As a security reviewer, I want the command text to live in the policy file and the stage to
   carry only a name, so that reviewing `rules.json` is sufficient to know what can run.
3. As an auditor, I want the ledger to say *which named command* ran, not only what string ran,
   so that a policy edit and an execution can be correlated after the fact.
4. As a maintainer of an existing project, I want my current routes and sessions to behave
   byte-identically after upgrading, so that adopting `verb` stages is opt-in per route.
5. As an incoming agent, I want one cursor to trust, so that "where is this work" has one answer.

## Implementation Decisions

Adjudications carried over from the 0025 map, in dependency order.

1. **`commandId` is a policy rule id (0026 Q3).** Resolution requires a rule in
   `.amber/governance/rules.json` satisfying all three predicates simultaneously: `id` equals the
   requested `commandId`, `action === "allow"`, and `match === "exact"`. The matched rule's
   `pattern` is the command. All three failure modes fail closed under one new error code,
   `AMBER_E_COMMAND_ID_UNRESOLVED`, with three distinguishable reason strings (unknown id / rule
   is not an allow rule / rule match mode is not exact). No path falls back to caller-supplied
   text. Rejected alternative: extending the runner capability record with a command field, which
   would reverse ADR-0022 six days after acceptance.

2. **Stage Verb ≡ registered runner capability (0026 Q5).** No new registry. A `verb` stage's
   `target` grammar is `runnerId@version#capability@version`, resolved through F052's existing
   lookup. Unregistered runner, version drift, integrity mismatch, and unregistered capability
   reuse F052's existing fail-closed codes — no parallel error vocabulary. Provider classes map
   onto existing implementations through one implementation-owned, closed adapter table keyed by
   the exact capability pin. The F052 record intentionally has no `provider` or implementation
   field, so a Route or caller cannot select an adapter. Each table entry is the closed tuple
   `capabilityPin`, `providerClass`, `adapterId`, `adapterVersion`; an exact pin maps to one adapter
   version. The mapping is:
   `bounded-command` → `governed-runner` plus decision 1;
   `external` → F056;
   `host-agent` → `agent-orchestration.js` artifact-only Agent Turn records;
   `native` → deterministic Amber code. An absent or mismatched adapter fails closed; no provider
   fallback is permitted. `external` is rejected by `session run` and must use the F056 lifecycle.

3. **One provider per capability (0026 Q4).** The earlier "multiple policy-constrained
   Provider/Model configurations with a selector" adjudication is revoked as speculative — Amber
   spawns no agent and routes no model. A second provider is a second registered capability.
   Retained from that adjudication: fail-closed refusals, immutable attempts (a switch creates a
   new attempt and never overwrites a failure record), and recording the selection in the run and
   its Evidence.

4. **`matchedRule` in the executed ledger record.** `evaluateExecutionPolicy` currently returns
   `null` on success (`governed-runner.js:94`), discarding the verdict, and
   `recordGovernedExecution` records only `action.command`. The verdict's `matchedRule` — already
   produced by `evaluateGovernedPolicy` (`loop-policy.js:70-85`) — must reach the executed record,
   or naming the command buys no auditability.

5. **Evidence receipt with output digest.** A named-command run records an Evidence receipt bound
   to that run. `stdout` is currently kept as a truncated 4000-character tail
   (`governed-runner.js:110-115`); a tail is not a digest, and ADR-0022 §2 requires a receipt to
   carry an "output reference or digest". Without the digest a `verify` stage cannot claim
   `replayable` assurance, only `observed`.

6. **Bounded commands are read-only (0030 §3, normative in ADR-0029).** `executeInWorktree`
   force-removes the worktree in a `finally` block (`governed-runner.js:118-120` →
   `worktree-manager.js:47-72`, `git worktree remove --force` then `fs.rmSync` recursive). Only
   the exit code and truncated output survive. Therefore a bounded named command may back only
   read-only or verification stages; any stage that must produce files is a host-agent stage.
   This restriction is currently implicit behaviour and must be stated in user-facing docs, or the
   first author to wire an implement stage to a bounded command will lose their output silently.

7. **`session run` / `session settle` (0033 Q6).** `run` executes the current stage when its
   provider is `native` or `bounded-command`; a `host-agent` stage returns a pending request
   instead of executing. `settle` records a host-agent result and permits the cursor to advance.
   Retry is a re-run producing a new attempt, not a separate verb. The proposed `amber work`
   top-level command with its own Work Item cursor is revoked: a work item is the existing
   feature/plan plus a session lease, and `session` stays the only cursor. The revoked proposal
   conceded that session stage fields would become projections that "cannot disagree" with the
   new cursor — two cursors that must not disagree are still two cursors.

8. **No new artifact tree (0029).** Stage inputs map to session timeline events plus Loadout
   references; attempts map to `.amber/executions/` (F052) plus the session ledger; outputs map to
   Canonical Artifact revisions and Evidence receipts; recovery maps to existing session
   checkpoints. The confirmed-missing count for artifacts is zero. If an implementation discovers
   a mapping with no home, that opens a new ticket with measured evidence — it does not add a tree
   to this spec.

   *Implementation amendment (2026-09-02):* the executed record for a session's bounded named
   command lands in the **session ledger** (`.amber/sessions/<id>/ledger.jsonl`), not
   `.amber/executions/` — governed-runner's `ledgerPath` has always been caller-supplied, and
   `.amber/executions/` is the agent-orchestration task-execution tree. See the dated amendment on
   ADR-0029 §8.4 for the full rationale (approval consumption is per-ledger).

9. **`schemaVersion` stays `const "1.0.0"` (0032 §2).** ADR-0012 grew this same schema by six
   fields without a bump and designated `amber_protocol_version` as the drift signal. Enum
   widening keeps every existing route valid; a `verb` route read by an older Amber fails
   validation, which is the correct direction to fail. Bumping would require a version↔stage-type
   cross-check in the validator plus a rewrite of every existing route file, in exchange for a
   more precise error message.

10. **No migration, no adapter, no feature flag, no compatibility window (0032 §1, §3).** Existing
    `pack`/`skill`/`gate`/`command` stages were never executable and their behaviour does not
    change, so there is nothing to migrate; the "compatibility Adapter Verbs" idea from the
    earlier artifact adjudication is revoked. A stage type no route references is already inert,
    so a flag would be a second opt-in over the first.

11. **`.claude-plugin/hooks.json` stays empty, by design (0031).** A plugin-level hook applies to
    every installer, which would make the per-turn breadcrumb automatic and violate the
    `CLAUDE.md` boundary stating it is opt-in and *never installed automatically*. Distribution
    stays `amber hooks breadcrumb install [--platform claude]`, merging into the user's own
    `.claude/settings.json`. JSON carries no comments, so this intent must be recorded in prose —
    otherwise the empty file reads as a misconfiguration and will eventually be "fixed".

12. **`.claude-plugin/settings.json` correction (0031).** The settings manifest is included in
   `sync-version.js`'s `TARGETS` alongside the two plugin manifests, so its package version stays
   synchronized with `package.json`. Its version is `1.6.0` at this revision and its description is
   `Amber Protocol Claude adapter settings.`; it is not an independent adapter-schema version and
   does not retain the obsolete placeholder description.

## Normative interface and state contract

This section is the implementation contract for T1–T4. It is intentionally expressed in terms of
existing Session, F052, F056, and Evidence records; it does not create a Work Item object, a second
cursor, or a new execution ledger.

### Capability and adapter resolution

The `verb` stage target is the exact pin `runnerId@version#capability@version`. Resolution must
produce the closed tuple `capabilityPin`, `providerClass`, `adapterId`, and `adapterVersion` from
the implementation-owned adapter table. The F052 capability record does not gain a provider field,
and neither a Route nor a caller can select an adapter. The supported provider classes are
`native`, `bounded-command`, `host-agent`, and `external`. A missing or mismatched table entry,
malformed pin, registry/version/integrity failure, or class mismatch refuses the stage and leaves
the cursor unchanged. `external` is rejected by `session run` and must use F056.

### Session lease

`run` and `settle` require the Session owner and lease proof and acquire the existing atomic
Session lock before reading or writing state. The lease record has the closed fields
`ownerId`, `tokenHash`, `acquiredAt`, `expiresAt`, `ttlMs`, and `fence`:

- `ownerId` is the non-empty `agentId` that owns the Session;
- `tokenHash` is the SHA-256 digest of the opaque token returned once to that owner; the raw token
  is never persisted;
- `acquiredAt` and `expiresAt` define the half-open UTC window `[acquiredAt, expiresAt)`;
- `ttlMs` equals `expiresAt - acquiredAt` and is bounded by the existing five-minute lock ceiling;
- `fence` is a monotonically increasing integer for the Session and is included in every attempt.

Expired, stale, mismatched, or otherwise invalid ownership refuses the operation. Reacquisition is
explicit, owner-bound, and creates a new fence; it never silently transfers an expired Session.

### One cursor and terminal states

The ordered prefix of the selected, version-pinned Route in the Session ledger is the sole cursor.
`manifest.json` fields `completedStages` and `currentStage` are projections of that prefix:
completed stages occur at most once and are contiguous; callers cannot select an arbitrary stage or
move backwards. A successful stage, or an explicitly skipped optional stage, is recorded before
the cursor advances. `failed`, `cancelled`, `unknown`, `timed_out`, and `rejected` attempts leave
the cursor in place. A non-optional stage cannot be skipped. `gateAfter` records completion first,
then blocks the next stage until the Gate passes; it never creates an Approval automatically.

When all stages are complete and no Gate is blocked, `currentStage` is absent and the Session is
`completed`. A completed, failed, or aborted Session is terminal for `run` and `settle`; ordinary
failed attempts remain retryable on the same stage. The Session is the only cursor authority.

### `run` request and attempt identity

The execute-mode request is internally materialized with exactly these fields:
`requestId`, `sessionId`, `routeId`, `routeVersion`, `routeHash`, `stageName`, `stageIndex`,
`stageType`, `stageTarget`, `capabilityPin`, `adapterId`, `adapterVersion`, `attemptId`,
`attemptNumber`, `idempotencyKey`, `leaseOwnerId`, `leaseFence`, `inputDigest`, `executionMode`,
`approvalRef` when required, `requestedAt`, and `deadlineAt`. The caller supplies only Session
identity, owner/lease proof, and dry-run or execute intent. Route/stage selection, capability and
adapter resolution, attempt numbering, and hashes come from the current Session. There is no
`--stage`, `--target`, `--command`, provider selector, or free-form shell field on this seam.

Dry-run returns the resolved request without creating an executable attempt or advancing the
cursor. `idempotencyKey` is derived from Session id, route hash, current stage, capability pin,
attempt number, and lease fence. Repeating the same request hash returns the existing pending or
settled record; reusing the key with different content refuses. Every retry creates new
`requestId`, `attemptId`, and `idempotencyKey`, increments `attemptNumber`, and consumes a fresh
single-use Approval when required. No request, Approval, or failure record is edited or reused.

### `settle` result and pending lifecycle

`settle` accepts only a pending request's `requestId`, `attemptId`, `leaseOwnerId`, `leaseFence`,
and `requestHash`, plus a result whose status is one of
`succeeded | skipped | failed | cancelled | unknown | timed_out | rejected`. The closed result
fields are `startedAt`, `finishedAt`, `exitCode` (integer or null), `signal` (string or null),
`timedOut` (boolean), `outputDigest` (or an explicit no-output marker), bounded `stdoutPreview`,
`stderrPreview`, `evidenceId` when execution produced Evidence, `artifactRefs`, and `errorCode`
and `reason` for non-success statuses. Unknown fields, missing bindings, a non-zero exit paired
with `succeeded`, or a missing required Evidence receipt fail closed. `unknown` includes missing or
ambiguous output and is never success.

The lifecycle is `pending → settled` for an accepted result, or `pending → expired` when its
deadline passes without settlement; a refused submission is `rejected` and does not advance the
cursor. A cancelled request is terminal. An exact duplicate settlement is idempotent; a different
result for the same attempt is corruption/refusal. Only `succeeded` (and `skipped` for an optional
stage) with a valid Evidence binding can advance the cursor. A `host-agent` run creates a pending
request and returns it; Amber never starts the Agent. An `external` mapping never creates a Session
attempt that performs the effect.

### Durable records and crash recovery

The pending request and every attempt transition are append-only events in
`.amber/sessions/<sessionId>/ledger.jsonl`; `manifest.json` contains only the latest cursor and
lease projection. Bounded execution/F052 settlement remains under `.amber/executions/`, Evidence
receipts under `.amber/evidence/`, and timeline entries are observability projections carrying the
request/attempt hash, never another cursor.

*Implementation amendment (2026-09-02):* "remains under `.amber/executions/`" is inaccurate
against the measured baseline — see decision 8's amendment and ADR-0029 §8.4. The executed record
for a session's bounded named command lands in the session ledger (the only self-consistent
placement, since approval consumption is per-ledger).

The write order is: acquire and verify the lease lock; append the immutable request event; perform
or return the attempt; record the Evidence receipt and any F052 execution settlement; append the
Session attempt-settled event with their ids and hashes; then atomically refresh manifest and
timeline projections. A crash before the settled event leaves the cursor unchanged. An orphaned
receipt or execution record remains visible but cannot count as success. A settled event with a
missing projection is replayed to rebuild that projection. Any manifest, timeline, execution-ledger,
or Evidence hash conflict fails closed; recovery never guesses or silently repairs divergence.

### Legacy and external seams

`session verify` and its legacy `--execute --command` path remain byte-compatible only for Routes
without a `verb` stage. They are not `run`/`settle` attempts, cannot resolve a `verb`, consume a
F062 Approval, settle a pending request, or advance a `verb` cursor. For a Route containing a
`verb`, a legacy operation that would write `completedStages` is refused and points to
`session run`/`session settle`; claim-only inspection may remain non-mutating.

CLI command registration, dispatch, validation, and error mapping for `session run` and
`session settle` must call this same typed seam. The seam rejects arbitrary stage selection,
free-form command text, and provider selection. `route test --execute` retains its legacy
`command`-stage behavior and is not an alias for `session run`. MCP exposes only the corresponding
governed Action Types as approval-required submissions or dry-run/read-only results; it never
starts a Runner, Agent, or External Effect.

## Tickets

- **T1 — Named governed commands** (no blockers): `commandId` resolution in `governed-runner`
  under decision 1, plus the `matchedRule` ledger field under decision 4. Adds
  `AMBER_E_COMMAND_ID_UNRESOLVED` to the error catalog.
- **T2 — Execution evidence** (blocked by T1): output digest and Evidence receipt binding under
  decision 5.
- **T3 — `verb` stage** (blocked by T1): the `type` enum entry, target-grammar resolution against
  F052, and the execution-guard branch in `route-commands.js`. Display paths
  (`route-commands.js:40,95`) print `stage.type` generically and need no change.
- **T4 — `session run` / `session settle`** (blocked by T2, T3): the two verbs under decision 7.
- **T5 — Landing** (blocked by T4): the read-only restriction (decision 6) and the empty-hooks
  intent (decision 11) written into user-facing docs; the `settings.json` correction
  (decision 12); `feature_list.json` registration with landing evidence; learnings review booked.

## Testing Decisions

Existing route, session, policy, and governed-loop suites are the regression net and run
**unedited**: `validate-route`, `route-loader`, `route-commands`, `route-selector`, `loop-policy`,
`policy-evaluation`, `loop-contract-governed`, and the twelve `session-*` unit tests; the
`route-commands`, `session-commands`, `migrate-command`, and `continue-recovery` integration
tests; the `migration-flow` and `concurrent-sessions` e2e tests.

New cases, each tracing to an adjudication:

| Case | Layer | Traces to |
| --- | --- | --- |
| `verb` stage validates; the four existing stage types still validate | unit `validate-route` | 9, 10 |
| Unregistered capability / version drift fails closed without advancing the cursor | unit `route-commands` | 2 |
| Unknown id, non-`allow` rule, and non-`exact` match each refuse with a distinguishable reason and never fall back to caller text | unit `governed-runner` | 1 |
| Executed record carries `matchedRule` | unit `governed-runner` | 4 |
| Two runs of one `commandId` require two independent approvals; reusing an approval fails | integration | ADR-0003 gate 3 |
| After execution the worktree is gone and no file output reaches the target repository | integration | 6 |
| A run produces an Evidence receipt carrying an output digest | integration | 5 |
| `session run` → `session settle` completes a host-agent stage end to end | e2e | 7 |
| An existing route behaves identically before and after the upgrade | e2e `migration-flow` | 10 |
| Hand-editing any generated platform surface makes `gen:agents:check` exit non-zero | existing CI | 11 |

Standard gates per ticket: `npm test` (full log written to disk and read whole — a piped tail does
not count), `npm run manifests`, `npm run doctor`, `npm run gen:agents:check`.

## Out of Scope

- A Stage Verb registry, a Work Runtime layer, a Provider abstraction, a `.amber/work-items/`
  artifact tree, an `amber work` top-level command, and a route `schemaVersion` bump — each
  measured against existing capability and rejected in the 0025 map.
- Antigravity and Orca platform generators. Those platforms use the CLI and the shared skill entry
  until a measured need appears.
- Bounded commands that produce files. That is a host-agent stage by decision 6, not a future
  extension of this feature.
- Auto-commit, push, scheduling, and any external write without a registered F056 effect.

## Further Notes

The five confirmed-missing items across seven adjudicated tickets are decisions 1, 4, 5, 12, and
the `verb` enum entry. Everything else this spec touches already exists and is reused. If
implementation finds a sixth, the honest move is a new ticket with measured evidence, not a
widening of scope inside T1–T5.
