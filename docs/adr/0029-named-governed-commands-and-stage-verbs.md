# ADR-0029: Named Governed Commands and Registered Stage Verbs

**Status:** Accepted
**Date:** 2026-09-02
**Builds on:** [ADR-0003](0003-governance-gated-execution.md) (the four governed-execution gates),
[ADR-0022](0022-pilot-execution-boundary-and-external-evidence.md) §5 (any new execution capability
requires its own ADR declaring its closed Action Type, policy, approval, isolation, target
confinement, credentials, recovery, and execution ledger),
[ADR-0012](0012-protocol-and-schema-versioning.md) (schema growth and drift signalling)
**Adjudicated in:** `issues/0025` map — tickets 0026, 0028, 0029, 0030, 0031, 0032, 0033

---

## Context

A route can describe a journey it cannot advance. `amber route test <route> --execute` accepts only
`command` stages; `pack`, `skill`, and `gate` stages refuse execution (ADR-0003 addendum). The
`skill` stage in particular declares work and then performs none of it, so the declared pipeline and
the executable pipeline are different pipelines.

The 0025 wayfinder map asked whether closing that gap needs a Work Runtime layer, a Stage Verb
registry, and a Provider abstraction. Measurement said no. The registry already exists: `amber
runner` (F052) holds versioned executor identities with closed capabilities — declared effects, path
scope, timeout bound, credential requirement, rollback declaration. External effects already have a
governed contract (`amber external`, F056). The four gates already exist as a shared primitive
(`scripts/lib/core/governed-runner.js`). `session` already owns the route cursor. What is missing is
narrow: no stage type points at a registered capability, and no verb advances the cursor by one
stage.

Measurement also surfaced a problem the map had not stated. `runGovernedCommand` takes command
*text*. A route stage carrying command text is exactly the shell-smuggling shape ADR-0022 closed off
inside the runner registry, whose header reads *"there is no command field anywhere, so callers can
never smuggle shell text through the registry."* Two neighbouring surfaces disagreed about whether a
caller may supply a command. Naming the command is what resolves that disagreement.

## Decision

### 1. Action Type — `governed.named-command`

Closed and single-purpose: one execution of one named command. Its parameters are a `commandId`, the
target repository root, a label, and a time budget. **No free-form command text appears anywhere in
the caller's input**, in a route stage, or in a CLI argument.

### 2. `commandId` resolves to a policy rule id

A `commandId` resolves against `.amber/governance/rules.json` and must match a rule satisfying all
three conditions: `id` equal to the requested `commandId`, `action: "allow"`, and `match: "exact"`.
The matched rule's `pattern` **is** the command.

Resolution fails closed. An unknown id, a rule whose action is not `allow`, and a rule whose match
mode is not `exact` each refuse execution outright; none of them falls back to caller-supplied text.

The command text therefore lives only in a file a human edits and a reviewer reads. The route stage
carries a name. This is a tightening of ADR-0003's default-deny allowlist, not a widening of it: the
set of runnable commands is a strict subset of what policy already permits.

### 3. Policy, approval, isolation, ledger — reused from ADR-0003

For a bounded named command, all five ADR-0003 preconditions hold without modification. *Declared*
is now the resolved rule rather than raw text; *policy*, *approved* (one unconsumed Approval per
attempt), *isolated* (dedicated git worktree), and *recorded* (tamper-evident hash-chain ledger) are
untouched. An Amber-native adapter does not execute a target-repository command or spawn a process;
it uses the existing governed Action contract for its internal deterministic operation and still
records the attempt and outcome. No adapter class may silently skip a gate that applies to its
declared effect.

One field is added to the executed ledger record: `matchedRule`. Without it the ledger records what
text ran but not which named command authorised it, and the naming would be unauditable.

### 4. Target confinement and recovery

A bounded named command runs in a dedicated worktree that is force-removed in a `finally` block.
Nothing the command writes to disk survives; only the exit code and truncated stdout/stderr do. That
behaviour is currently implicit, and this ADR makes it normative:

> A bounded named command may be used only for **read-only or verification** stages. A stage that
> must produce files — implement, refactor, migrate — is a host-agent stage, not a bounded command.

Recovery is consequently trivial and there is nothing to roll back: the isolation *is* the rollback.
Rollback and compensation for effects that do persist stay where they already live —
`amber runner rolled-back` with its rehearsal Evidence (F052) and `amber external compensate` with
its compensating-effect or irreversibility declaration (F056). This ADR adds no third rollback path.

### 5. Credentials

None. A bounded named command inherits no credential handle and is granted none. Any operation
needing a scoped credential is a runner request (F052) or an external effect (F056); both already
model credentials as short-lived opaque handles that never carry secret values.

### 6. Evidence

A named-command execution records an Evidence receipt bound to that run. The receipt's output digest
is SHA-256 over a canonical output envelope containing the complete raw `stdout` and `stderr` bytes,
their byte lengths, exit code, signal, timeout flag, normalized start/end timestamps, terminal
status, capability pin, request id, and attempt id. The bytes may be streamed to the hasher and need
not be retained in full, but a bounded preview is retained for inspection and is never used as the
digest. A truncated output tail alone does not satisfy ADR-0022 §2's requirement that a receipt
identify an "output reference or digest", so a `verify` stage without this digest cannot claim
`replayable` assurance. `verified` remains available only through an independent verifier.

### 7. Route `verb` stage and the closed adapter map

`schemas/route.schema.json` gains `"verb"` in the stage `type` enum. A `verb` stage's `target` is
`runnerId@version#capability@version` and resolves against the F052 registry. The F052 capability
record intentionally has no `provider` or implementation field. Provider selection is therefore
not route data and is not caller-controlled: the implementation owns one closed table keyed by the
exact capability pin. Each entry contains `capabilityPin`, `providerClass`, `adapterId`, and
`adapterVersion`; one exact pin maps to exactly one adapter version. Adding or changing an entry is
a reviewed code change, not a new registry or a mutable target-repository record.

The closed mapping is:

| Provider class | Controlled adapter | Session behaviour |
| --- | --- | --- |
| `native` | deterministic Amber implementation identified by `adapterId@adapterVersion` | execute the internal governed action; never spawn a process or mutate the target repository |
| `bounded-command` | `governed-runner` plus the named-command resolver in §2 | execute only a read-only/verification command in the disposable worktree; use the ADR-0003 gates |
| `host-agent` | the existing artifact-only Agent Turn request/record seam | emit a pending request; Amber never starts an Agent or claims its result |
| `external` | F056 `amber external` lifecycle | reject from `session run`; the caller must use the registered External Effect contract |

An unregistered runner/capability, runner or capability version drift, integrity mismatch, malformed
target pin, absent adapter entry, or adapter/capability class mismatch fails closed and does not
advance the cursor. F052 lookup errors are reused for registry failures; the stage seam uses
`AMBER_E_STAGE_ADAPTER_UNAVAILABLE` for an absent/mismatched adapter and
`AMBER_E_STAGE_EXTERNAL_LIFECYCLE_REQUIRED` when an external effect is attempted through a Session.
Neither error permits fallback to another adapter or to caller-supplied command text.
(Implementation amendment 2026-09-02: this code was drafted as
`AMBER_E_STAGE_EXTERNAL_REQUIRES_F056`, but the error catalog's closed convention — enforced by
`tests/unit/error-catalog.test.js` — admits `[A-Z_]` only, no digits; the digit-free spelling above
carries the same meaning.)

`schemaVersion` stays `const "1.0.0"`. ADR-0012 grew this same schema by six fields
(`amber_protocol_version`, `artifact_sequence`, `created_at`, `artifact_type`, `execution_mode`,
`objective`) without a bump, and designated `amber_protocol_version` as the drift signal. Enum
widening is backward compatible for every existing route; a `verb` route read by an older Amber
fails validation, which is the correct direction to fail.

Existing `pack`, `skill`, `gate`, and `command` stages keep their behaviour byte for byte. There is
no migration, no compatibility adapter, and no compatibility window, because the old stage types were
never executable and nothing about them changes.

### 8. `session run` and `session settle`

`session` gains exactly two typed verbs. `run` evaluates and, in execute mode, starts the current
stage. `settle` accepts only the structured result for the pending attempt. There is no new
top-level command, no Work Item object, and no second state machine. `session` remains the only
authority that advances a route.

#### 8.1 Lease and ownership

The Session lease is the existing `agentId` owner plus a short-lived fencing record. Its logical
fields are:

| Field | Contract |
| --- | --- |
| `ownerId` | the non-empty `agentId` supplied to `session start`; `agentId` is the owner identity, not a display label |
| `tokenHash` | SHA-256 of a random opaque lease token returned once to the owner; the raw token is never written to a ledger or preview |
| `acquiredAt` / `expiresAt` | UTC timestamps defining a half-open lease window `[acquiredAt, expiresAt)` |
| `ttlMs` | `expiresAt - acquiredAt`, bounded by the existing five-minute session-lock ceiling |
| `fence` | monotonically increasing integer for this Session; it increments on an explicit reacquisition and is included in every attempt/request |

`run` and `settle` must present the owner and lease token and must acquire the existing atomic
Session lock before reading or writing state. While the lock is held they verify the token hash,
fence, and unexpired window. A stale owner, expired token, fence mismatch, or lock acquisition
failure refuses the operation. No command silently transfers an expired Session to another owner;
renewal/reacquisition is explicit, owner-bound, and creates a new fence. A request carrying an older
fence can never settle a newer attempt.

> **Implementation amendment (2026-09-02):** the proof of ownership is the token's SHA-256 digest
> (the CLI `--token-hash` flag), not the raw token — the operator receives the raw token once,
> hashes it, and presents the digest, which is compared against the persisted `tokenHash`. This is
> a deliberate reading of "present the lease token": under the threat model where any process that
> can read `.amber/` is already trusted (the state directory is Amber-governed repository state),
> a raw-token round trip buys no additional security over digest equality, and the digest form
> never places raw token material in a shell argument's process listing twice. Reacquisition is
> implemented as `amber session lease --session <id> --owner-id <agent> --token-hash <digest>`:
> owner-bound, minting a fresh token and fence + 1 for the same session. Dry-run `run` takes no
> lock and verifies no lease — it is a read-only resolution (see the code comment at
> `session-stage-runner.js`, "Dry-run projects the lease it WOULD run under").

#### 8.2 The one cursor

The canonical cursor is the ordered prefix of the selected, version-pinned Route in the Session
ledger. `currentStage` and `completedStages` in `manifest.json` are projections of that cursor, not
independent state:

* On routing, `completedStages` is `[]` and `currentStage` is the first stage name.
* `completedStages` contains each route stage name at most once and always equals a contiguous
  prefix of the route. `currentStage` is the first stage after that prefix; callers cannot select an
  arbitrary stage or move it backwards.
* A `succeeded` or explicitly `skipped` optional stage is recorded before the cursor moves. A
  non-optional stage cannot be skipped. `failed`, `cancelled`, `unknown`, `timed_out`, and
  `rejected` attempts do not change the cursor.
* When `gateAfter` is present, the stage remains in `completedStages` first. The next stage is
  blocked until that Gate passes; a failed Gate records a deny/blocked outcome and never grants an
  Approval automatically.
* When every stage (including explicitly skipped optional stages) is complete and no Gate is
  blocked, `currentStage` is absent and the Session is `completed`. A completed, failed, or aborted
  Session is terminal for `run`/`settle`.

An ordinary failed attempt leaves the Session recoverable and the cursor on the same stage; a
terminal Session `failed` state is reserved for an unrecoverable protocol/state failure. Retry is a
new attempt, never an edit of the failed record.

#### 8.3 Closed request/result contract

The execute-mode `run` request is internally materialized with the closed fields
`requestId`, `sessionId`, `routeId`, `routeVersion`, `routeHash`, `stageName`, `stageIndex`,
`stageType`, `stageTarget`, `capabilityPin`, `adapterId`, `adapterVersion`, `attemptId`,
`attemptNumber`, `idempotencyKey`, `leaseOwnerId`, `leaseFence`, `inputDigest`, `executionMode`,
`approvalRef` (when the selected adapter requires Approval), `requestedAt`, and `deadlineAt`.
The CLI/MCP caller supplies only Session identity, owner/lease proof, and execute/dry-run intent;
the Route, stage, capability, adapter, attempt number, and hashes are read from the current
Session. There is no `--stage`, `--target`, `--command`, provider selector, or free-form shell field
on this seam. Dry-run returns the resolved request without creating an executable attempt or
advancing the cursor.

`idempotencyKey` is derived from the Session id, route hash, current stage, capability pin, attempt
number, and lease fence. A repeat with the same request hash returns the existing pending/settled
record; the same key with different content refuses. Each retry increments `attemptNumber`, creates
new `requestId`/`attemptId`/`idempotencyKey`, and consumes a fresh single-use Approval when one is
required. An Approval, request, or failure record is never reused or overwritten.

`settle` accepts only a pending request's `requestId`, `attemptId`, `leaseOwnerId`, `leaseFence`,
`requestHash`, and a result with this closed status set:
`succeeded | skipped | failed | cancelled | unknown | timed_out | rejected`. The result envelope
contains `startedAt`, `finishedAt`, `exitCode` (integer or null), `signal` (string or null),
`timedOut` (boolean), `outputDigest` (or an explicit no-output marker), bounded `stdoutPreview` and
`stderrPreview`, `evidenceId` (when execution produced Evidence), `artifactRefs`, and an `errorCode`
and `reason` for non-success statuses. Extra fields, missing binding fields, a non-zero exit paired
with `succeeded`, or a missing Evidence receipt fail closed. `unknown` includes missing/ambiguous
output and can never be interpreted as success. `settle` rejects a request that is expired, already
settled, cancelled, or bound to another owner/fence; an exact duplicate settlement is idempotent,
while a different result for the same attempt is a corruption/refusal.

Only `succeeded` (and `skipped` for an optional stage) with a valid Evidence/receipt binding may
advance the cursor. A host-agent `run` writes a pending Agent Turn request and returns it; it never
launches the Agent. The host returns the closed result through `settle`. An `external` mapping never
creates a Session attempt that performs the effect.

#### 8.4 Durable placement and crash recovery

The pending request and every attempt transition are append-only events in the existing
`.amber/sessions/<sessionId>/ledger.jsonl`; the manifest contains only the latest cursor/lease
projection. Bounded execution and its settlement continue to use the existing `.amber/executions/`
ledger; Evidence receipts continue to use `.amber/evidence/`. No Work Item or parallel attempt tree
is introduced. Timeline entries are observability projections and carry the request/attempt hash;
they are never a second cursor.

> **Implementation amendment (2026-09-02):** the executed-record placement above is inaccurate
> against the measured baseline. `governed-runner` has never had a `.amber/executions/` home — its
> `ledgerPath` is always caller-supplied, and `.amber/executions/` is the agent-orchestration
> task-execution tree. For a session's bounded named command, the `executed` record lands in the
> **session ledger** (`.amber/sessions/<id>/ledger.jsonl`), which is also the only self-consistent
> placement: approval consumption is per-ledger (`latestUnconsumedApproval`), so the approval and
> its consumption must share one hash chain. The records stay durable, hash-chained, and fully
> correlated with the settled event via requestId/attemptId/evidenceId/outputDigest; the
> compliance audit that caught this is `spec-compliance/` (2026-09-02, REQ-12).

The commit order is: acquire/verify the lease lock; append the immutable request event; perform or
return the attempt; record the Evidence receipt and any F052 execution settlement; append the
session attempt-settled event containing their ids and hashes; then atomically refresh the manifest
and timeline projections. A crash before the settled event leaves the cursor unchanged. A receipt
or execution record without a settled event is an orphan that remains visible and cannot be treated
as success. A settled event with a missing projection is replayed to rebuild the projection. A
manifest, timeline, execution ledger, or Evidence hash conflict fails closed; no recovery path
guesses or silently repairs a divergent record.

#### 8.5 Legacy verification boundary

`session verify` and its `--execute --command` path remain a legacy compatibility surface for Routes
that contain no `verb` stage; their existing claim/evidence behaviour remains byte-compatible. They
are not a `run` or `settle` attempt. They may not supply or resolve a `verb` target, consume a F062
Approval, settle a pending request, or advance a `verb` cursor. For a Session whose selected Route
contains a `verb`, any legacy verification operation that would write `completedStages` is refused
and directs the caller to `session run`/`session settle`; claim-only inspection may still be
recorded without cursor mutation. The legacy free-text command is never accepted by the new typed
seam.

#### 8.6 CLI, typed seam, and MCP boundary

F062 owns the `session/run` and `session/settle` Action Type definitions, command-help entries,
dispatcher bindings, input validation, and error mapping. The typed seam exposes the closed fields
above and rejects unknown fields, arbitrary stage selection, free-form command text, and provider
selection. `route test --execute` keeps its legacy `command`-stage behaviour; it is not an alias for
`session run` and does not execute a `verb` stage.

MCP exposes `amber.session.run` and `amber.session.settle` only as the corresponding governed
Action Types. Because they can mutate Session state or cause a governed execution, the MCP adapter
returns an approval-required submission (or a dry-run/read-only result) and never starts a Runner,
Agent, or External Effect. The CLI and MCP paths call the same typed seam; neither path has a
second cursor or a private fallback.

## Still forbidden

Everything ADR-0003 forbids remains forbidden — scheduling, daemons, unattended runs, auto-approval,
self-approval, tool-call interception, arbitrary unlisted commands. This ADR adds four:

- Free-form command text in a route stage, a CLI argument, or any other caller-supplied position for
  governed execution.
- Amber spawning a registered F052 runner. Registration confers identity, not a launcher (ADR-0022).
- Auto-commit or push on stage completion.
- A provider performing an external write without a registered External Effect (F056).

## Consequences

**Positive.** A route can advance itself under the gates it already declares, and the `skill` stage
stops being a dead end. The named-command contract removes the last position where a caller could
hand Amber command text, aligning `governed-runner` with the closed-capability rule the runner
registry has enforced since ADR-0022. The ledger becomes answerable to "which named command ran",
not merely "what string ran".

**Negative.** A `verify` stage must be expressible as one exact command string. A route author who
wants a slightly different flag has to edit the policy file and have that edit reviewed. That
friction is the feature, but it is real friction and will be felt first by whoever writes the second
route. The read-only restriction on bounded commands also means the most valuable stage —
implementation — remains a host-agent stage that Amber cannot complete on its own.

**Neutral.** Default behaviour is unchanged: nothing executes without `--execute` plus an unconsumed
approval, and `run` without those remains a dry-run. A `verb` stage that no route uses is inert, so
the capability ships dark until a route opts in.

## Rejected alternatives

- **A new Stage Verb registry.** Duplicates F052's registration, versioning, integrity digests,
  approval binding, and execution ledger. The 0027 boundary already forbids re-implementing Amber's
  existing Evidence and ledger machinery; a second registry would have done exactly that.
- **Putting command text into the runner capability record.** Reverses ADR-0022's closed-capability
  decision six days after it was accepted, and reopens the shell-smuggling path that decision closed.
- **A new `amber work` top-level command owning a Work Item cursor.** The proposal itself conceded
  that session stage fields would become projections that "cannot disagree" with the new cursor. Two
  cursors that must not disagree are still two cursors.
- **Bumping route `schemaVersion` to 1.1.0.** Buys a more precise validation error; costs a
  version↔stage-type cross-check in the validator plus a rewrite of every existing route file, in a
  schema whose own precedent is growth without a bump.
- **A feature flag for `verb` stages.** A stage type that no route references is already opt-in.
  Wrapping it in a flag is a second opt-in over the first.

## Related

- [ADR-0003](0003-governance-gated-execution.md) — the four gates this extends
- [ADR-0022](0022-pilot-execution-boundary-and-external-evidence.md) — closed capabilities, receipt
  contract, and the §5 requirement this ADR answers
- [ADR-0012](0012-protocol-and-schema-versioning.md) — schema growth and `amber_protocol_version`
- F052 (`docs/specs/F052-controlled-runner-environment-boundaries.md`) — runner and capability
  registry
- F056 (`docs/specs/F056-registered-external-side-effects.md`) — external effect contracts
- `issues/0025-amber-native-stage-orchestration.md` — the decision map and its measurement record
