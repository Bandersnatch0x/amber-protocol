# ADR-0020: Governed Live Git Transport for the Sync Runtime

**Status:** Accepted (2026-08-25 — the five open questions adjudicated by the repository owner; see
"Adjudicated decisions" below). Terminology correction recorded 2026-09-01 below.
**Date:** 2026-08-25
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md) (governance-first, artifact-first),
[ADR-0003](0003-governance-gated-execution.md) (the five governed-execution preconditions),
[ADR-0011](0011-safety-philosophy-upgrades.md) (confidence bands, explicit fail-closed),
[ADR-0019](0019-distributed-governance-stage1-decisions.md) (envelopes are carried by git)
**Authority:** F035 plan decision D1
(`docs/plans/F035-Harden-distributed-sync-admission-and-fail-closed-boundaries.md`) — "live transport
needs its own accepted ADR (follow-up only, not this feature)"

---

## Context

F035 (accepted) removed all ungoverned Git side effects from the Sync Runtime. `sync session run|push`
is now transport **preparation/report-only**: `pushEnvelopes` (`scripts/lib/core/sync-session.js`)
returns `{mode: "prepare", envelopeCount, envelopeIds, envelopePaths, affectedPaths, proposedOps,
remoteConfigured, conflictCount, refusedCount, note, errors}`, where `proposedOps` is an array of
strings (`git add .amber/sync`, a generated commit message, and `git push` only when a remote is
configured via the read-only `git remote` query). No `--execute` escape hatch exists, and the F035
plan's deviation table names the follow-up this ADR must be: a design covering **policy, approval,
isolation, execution evidence, remote-write authorization, and recovery** before any live transport
is added.

Because ADR-0019 D1 chose git as the envelope carrier (precision note, #273 follow-up: D1
deferred the carrier decision — git is settled here, in this ADR) (`.amber/sync/envelopes/`
committed to the shared Team Hub repository and exchanged via git remote), "live transport" is
exactly three git verbs on the target repository: `git add .amber/sync`, `git commit`, `git push`.
There is no bespoke transport protocol to govern — the question is narrow and concrete: may Amber
execute those three verbs, and under what gates?

The standing boundaries (root `agents.md`, operating manual §1 and §7) apply: read-only first; Amber
never auto-executes target-project commands; user files are never overwritten without explicit
approval; typed mutations require explicit `--yes` (the F019 seam, `scripts/lib/cli-typed-seam.js`,
which returns `approvalRequired: true`, exit 1, for any typed write invoked without `--yes`/`--confirm`).
The manual already lists "branch/commit/PR creation" among the operations that require explicit
approval, so a gated commit is inside the contemplated envelope; push is not.

Three precedents already govern mutation in this repo, and any option that executes must reuse their
vocabulary rather than invent a fourth dialect:

1. **Loop approval flow** (ADR-0003; `scripts/lib/core/loop-execution.js`,
   `scripts/lib/core/governed-runner.js`): `amber loop approve --file <pack> --contract <id>
   --reviewer <name>` mints a single-use `approvalKey`; one approval ⇒ one execution
   (`latestUnconsumedApproval`). Five preconditions: declared (the contract's `governed.command`,
   never ad hoc CLI input), policy-passed (`.amber/governance/rules.json`, deny-wins,
   default-deny), approved, isolated (a dedicated worktree), recorded (tamper-evident hash-chain
   ledger). ADR-0011 adds confidence bands — uncertainty flows downward, never upward.
2. **MCP approval-required pattern** (F018; `scripts/lib/mcp-action-contracts.js`): mutating
   operations are returned as approval-required submissions and **never spawned** by the adapter;
   only registry-proven read-only variants execute directly; corrupt state and non-zero command
   results fail closed as `isError`.
3. **Memory pipeline identity gate** (ADR-0018; `scripts/lib/memory-commands.js` `identityGate`):
   a non-TTY invocation without an explicit `--yes` refuses fail-closed with
   `AMBER_E_MEMORY_APPROVAL_REQUIRED` — and agents never pass `--yes`.

The tension this ADR must resolve: everything Amber executes today (loop `governed.command`, route
command-stages) runs inside an isolated worktree that is **deleted afterwards**
(`governed-runner.js` `executeInWorktree` removes the worktree in a `finally` block). Transport's
purpose is the opposite — it must mutate the user's real checkout and publish to the repository's
shared remote. The worktree isolation gate cannot be inherited as-is. And `git push` is a
shared-state mutation visible to other people: the highest-risk class of write, categorically above
anything the governed surface currently performs, and adjacent to ADR-0003's still-forbidden
"external writes" list (PRs, issue trackers, notifications, account-bearing CLIs).

## Decision

**Accepted 2026-08-25: staged governed execution (enter through Option 4, grow into Option 2)** —
the recommendation below was reviewed and accepted by the repository owner, together with the five
adjudications recorded in "Adjudicated decisions" (which resolve every item formerly under "Open
questions for review"). ADR-0003's boundary text is amended explicitly per adjudication 1.

### Recommendation: staged governed execution (enter through Option 4, grow into Option 2)

If live transport is enabled at all, it should enter as governed execution behind the repo's
existing approval vocabulary, in two stages separated by the commit/push risk cliff:

- **Stage A — local, reversible verbs only.** `git add .amber/sync` + `git commit` behind the full
  gate set below. `git push` stays report-only (the human replays one command, or a Stage B decision
  is taken later on evidence).
- **Stage B — the shared-state verb.** `git push` joins the gated path only after Stage A has real
  execution evidence, and carries the additional push-specific invariants (origin-only,
  fast-forward-only, and the ADR-0003 external-writes adjudication in the accepting ADR).

One sentence carries the argument: Amber already possesses a proven, auditable, human-gated
execution seam (ADR-0003/0011), so the honest question is not *whether* Amber may execute but
*whether push's shared-state risk deserves a gate stronger than the ones already built* — and the
staged entry answers that by keeping the riskiest verb manual until the safer one has evidence.

### The gate mapping (F035's six named concerns)

Any executing option must answer all six concerns the F035 plan named. Mapped against ADR-0003's
five preconditions:

1. **Declared (policy input).** The command set is closed and pinned: exactly `git add
   .amber/sync` (narrowed by adjudication 4 as shipped: `.amber/sync/envelopes` +
   `.amber/sync/transport/decisions`), `git commit -m "amber sync: N envelope(s)"` (message
   derived from the report, never caller-supplied), and — Stage B only — `git push` with no
   URL/refspec arguments. No
   `reset`, `checkout`, `clean`, `rebase`, or `push --force` is ever declared or executable. This
   preserves ADR-0003 precondition 1 (declared, not ad hoc) while shrinking the declared surface to
   three deterministic verbs.
2. **Policy-passed.** Deny-wins `.amber/governance/rules.json` evaluation, identical to every other
   governed command (a new rule family for sync transport; a missing or invalid policy file refuses
   execution, never runs "without a policy" — ADR-0011).
3. **Approved.** One unconsumed human approval per batch (the loop `approve` shape: reviewer,
   single-use `approvalKey`, one approval = one execution), **plus** the memory-style identity
   gate: a non-TTY invocation without an explicit `--yes` refuses fail-closed
   (`AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED`); agents never pass `--yes`. The F019 typed seam
   applies unchanged: a typed write without `--yes`/`--confirm` returns `approvalRequired: true`
   and exits 1. Scheduling, cron, hooks, or loop-triggered transport remain forbidden (ADR-0003
   "no unattended runs").
4. **Isolation — replaced, not inherited.** Worktree isolation is impossible for transport: a
   worktree commit does not publish the user's checkout, and merging it back would require a second
   governed mutation (compounding, not isolating). Its replacement is **path-and-state
   confinement**: only `.amber/sync/**` paths may be staged; execution refuses with a typed failure
   if the index already holds staged changes or the working tree carries user-owned changes outside
   `.amber/sync` that could be swept into the commit; and the pull-side ledgers
   (`applied.jsonl`, `refused.jsonl`, `conflicts.jsonl`) are carried as files but never written or
   rewritten by transport (adjudication 4 later excluded them from the staged pathspec entirely —
   they are local-only and never shared). This gate is genuinely weaker than worktree isolation and
   must be tested
   adversarially (dirty-tree mix-ins, pre-staged index, symlinked sync paths) before Stage A ships.
5. **Recorded (execution evidence).** Every attempt — denied or executed, including a failed Stage A
   git operation — appends to a tamper-evident hash-chain ledger in the loop-ledger family, recording the
   approval key consumed, the proposed-ops fingerprint (envelope ids + affected paths from the
   preparation report), the git exit codes, captured stderr, and the resulting commit sha. Evidence
   kind: a `transport-record`, booked like every other evidence artifact. Attempt outcomes use the
   existing `denied` and `executed` record kinds: an approval-gate refusal is `kind: "denied"` with
   `gate: "approval"`, while a failed Stage A git operation is `kind: "executed"` with
   `stopReason: "commit-failed"`. The ledger also carries `approved`, `downgraded`, and
   `transport-decision` records. *(Corrected 2026-09-01 — see the identity-gate correction below.)*
   An `APPROVAL_REQUIRED` exit (the identity gate's non-TTY refusal, or the F019-shaped
   `approvalRequired` envelope on a TTY) is an authorization inquiry *before* an attempt exists
   and is deliberately not a ledger record class.

**Remote-write authorization (Stage B).** Push may target only the repository's already-configured
origin — the same remote `identity.js` reads to normalize `repositoryId` — never a caller-supplied
URL. Push is fast-forward-only: a non-fast-forward remote is a typed refusal, and `--force` is
never proposed or executed. The accepting ADR must also adjudicate the ADR-0003 boundary explicitly:
pushing the repository's own `.amber/sync` tree to its own origin is categorically different from
the forbidden third-party external writes, but that reading must be written into the boundary text,
not assumed by silence.

**Recovery and mid-batch failure semantics.** `git push` is atomic per ref, so no partial push
exists at the git level; the failure mode is commit-ahead-of-remote. Retry is safe: `git add
.amber/sync` is idempotent (nothing new staged ⇒ the commit step reports a typed
nothing-to-commit outcome, never a duplicate empty commit). Envelope files are immutable (named by
`envelopeId`, never rewritten), so a failed batch leaves `.amber/sync/envelopes/` exactly as the
report described. The pull-side ledgers are the structural backstop: `applied.jsonl` is only
appended after a successful apply, a refused envelope is never marked applied, and replay is
idempotent — transport failure cannot corrupt admission state, and anything that does land on a
peer is re-adjudicated by the peer's fixed-order admission pipeline (schema → artifact path/type →
protocol → tenant → repository → generation → content hash). Recovery is human: fix the cause,
re-run preparation, re-approve, re-execute. No automatic retry.

**Typed error codes.** A closed `AMBER_E_SYNC_TRANSPORT_*` family in
`scripts/lib/core/error-catalog.js` (one code per failure mode, each with title/cause/remedy/layer):
`APPROVAL_REQUIRED` (non-TTY without `--yes`), `NOT_APPROVED` (no unconsumed approval — mirrors
`AMBER_E_LOOP_NOT_APPROVED`), `POLICY_REFUSED` (mirrors `AMBER_E_POLICY_DENY`), `DIRTY_TREE`
(pre-existing staged or user-owned changes outside `.amber/sync`), `REMOTE_NOT_CONFIGURED`
(currently a report note; under execution a typed failure), `COMMIT_FAILED`, `PUSH_FAILED`, and
`NOT_FAST_FORWARD`. Non-zero git results are failures, never empty successes (F035 S5's fail-closed
rule extends to the transport path).

**MCP surface.** If `sync session push --execute` is ever exposed as an Action, it registers as a
write capability (`approver: "human"`, `directReadOnlyExec: false`, `writeFlags: ["--execute"]`,
`edits` confined to `.amber/sync/**`) — and the MCP adapter still returns it as approval-required
and never spawns it. The F018 invariant is unchanged: no four-gate governed runner adapter exists
for MCP mutations.

### Options mapped

1. **Preparation-only permanently.** The report is the contract; a human replays `proposedOps`
   manually. Zero new governance surface; Amber stays execution-free by construction; every
   downgrade path already lands here. Trade-offs: no automation for multi-repo fleets; manual
   replay is unverifiable (no execution-evidence kind exists for what Amber did not do); and the
   three-verb replay is exactly the kind of mechanical step humans err on. Ledger interaction:
   none — the report surfaces `conflictCount`/`refusedCount`, refused envelopes are never marked
   applied, and if a human pushes anyway the receiving admission pipeline refuses idempotently.
2. **Governed execution behind approval (full: add/commit/push).** Automation with a complete
   audit trail, one approval per batch, reusing three proven precedents (loop approval, MCP
   approval-required, memory identity gate) instead of a new mechanism. Trade-offs: it is Amber's
   first mutation of the user's real checkout and — with push — its first shared-state write; the
   isolation gate must be replaced by the weaker path-and-state confinement; and the ADR-0003
   external-writes boundary needs explicit amendment. Ledger interaction: pending conflict
   resolutions downgrade transport to preparation-only (uncertainty flows downward, ADR-0011);
   transport never writes the admission ledgers; attempts land in the transport ledger.
3. **External executor contract.** The preparation report becomes a stable, schema-governed,
   ADR-0012-versioned machine-readable artifact; a separate tool outside Amber consumes it. Amber
   stays execution-free by construction and `executesAnything: false` keeps its exact meaning.
   Trade-offs: the executor is an ungoverned surface (nothing stops an agent wrapping it in a
   loop); Amber receives no execution evidence unless the contract adds a write-back step, which
   needs its own admission; and `proposedOps` must become structured operations (verb, args,
   confined paths), not shell strings — parsing strings into execution is an injection-shaped
   hazard the contract must remove. Ledger interaction: the artifact carries the conflict/refusal
   summary; the ledgers remain pull-side only; whether an executor honors them is outside Amber's
   control. Note this option is composable with 1 and 4 — publishing a structured report contract
   does not require deciding against execution.
4. **Staged split: governed local commit, manual push (recommended entry).** Commit is local,
   reflog-reversible, and invisible to others; push is the shared-state verb and stays manual.
   Captures most of the automation value (correct batching, deterministic message, path
   confinement, evidence) with none of the shared-state exposure, and respects the risk cliff
   between the two verbs. Trade-offs: two-step UX; fleet push remains manual; the accepting review
   must still define what evidence promotes push into Stage B. Ledger interaction: as Option 2 for
   the commit step; push interaction stays as Option 1.

## Considered and rejected

- **An ungated `--execute` escape hatch.** F035 explicitly refused it; it would be the only
  ungated mutation seam in the system.
- **Worktree-executed transport.** A worktree commit does not publish the user's checkout, and
  `governed-runner` deletes the worktree after the run; syncing the commit back would need a second
  governed mutation. Compounding, not isolating.
- **Caller-supplied git commands or commit messages.** Declared-and-pinned only; the message is
  derived from the report so the ledger fingerprint is reproducible.
- **Automatic retry or force-push recovery.** Unattended execution is a still-forbidden class
  (ADR-0003); `--force` would convert a divergence signal into data loss.
- **Agent-invoked execution.** The identity gate exists precisely so the `--yes` attestation is
  human; any agent path that could pass it would void the ADR-0018 precedent.

## Consequences

**Positive.** The deferred F035 D1 follow-up gets one decision seam: all six named concerns (policy,
approval, isolation, execution evidence, remote-write authorization, recovery) have explicit
answers; the staged entry respects the commit/push risk cliff; the design reuses three proven
approval precedents rather than inventing a fourth dialect; every failure is typed and fail-closed;
and the pull-side admission pipeline remains the ultimate backstop regardless of which option is
chosen.

**Negative.** If accepted, Amber executes its first mutation of the user's real checkout and — at
Stage B — its first shared-state write; the "Amber never runs git" one-liner must be restated
precisely everywhere it appears (CLI help, `agents.md`, regenerated platform products, wiki), the
same way ADR-0003 required restating "we never execute". Per-batch approval ceremony is a real
attention cost. The isolation-gate replacement is weaker than worktree isolation and needs
adversarial tests before Stage A.

**Neutral.** Preparation/report-only remains the default, the downgrade target, and the permanent
fallback — no option removes it. Option 3's structured report contract is worth publishing under
any outcome. The `sync session run|push` preparation report itself is unchanged by this ADR; only
an executing variant would be added.

## Adjudicated decisions (2026-08-25, repository owner)

The five open questions below were adjudicated by the repository owner when this ADR was accepted.
Each records the decision and its binding consequence.

1. **Push vs. the ADR-0003 external-writes boundary — accepted: outside the forbidden class.**
   Pushing the repository's own `.amber/sync` tree to its own already-configured origin is
   self-owned governance state, categorically different from third-party external writes. The
   boundary text in [ADR-0003](0003-governance-gated-execution.md) is amended explicitly (see its
   "Still forbidden" section): caller-supplied remote URLs and every third-party surface remain
   forbidden; origin-only push under Stage B gates is not.
2. **Pending conflicts — downgrade, not hard-block.** With any pending conflict, outbound transport
   downgrades to preparation-only (ADR-0011: uncertainty flows downward). A long-lived pending
   conflict unrelated to the outbound batch must not deadlock a repository's sync.
3. **Stage B promotion trigger — explicit human decision only.** No quantitative auto-promotion
   (no "N batches anomaly-free" threshold). Stage A evidence informs the decision, but `git push`
   joins the gated path only by an explicit human configuration change. This matches the
   governance-first philosophy: evidence accumulates, authority does not.
4. **Ledger sharing — envelopes only.** The transport `git add` path is narrowed to
   `.amber/sync/envelopes/` (plus a transport decision record); the pull-side ledgers
   (`applied.jsonl`/`refused.jsonl`/`conflicts.jsonl`) are never shared — every clone's append-only
   ledgers would otherwise collide on merge. Transparency is preserved by the envelopes plus local
   ledgers. This changes `affectedPaths` semantics: the preparation report's proposed `git add` must
   reflect the narrowed path set.
5. **Structured report contract — publish immediately, independent of execution.** Option 3's
   ADR-0012-versioned, schema-governed machine-readable execution-report contract is compositional
   with every other option and is approved for publication now, de-risking the executor ecosystem
   without touching the execution decision. **Published as F040** (2026-08-25):
   `schemas/sync-transport-report.schema.json` (`schemaVersion: "1.0.0"`, closed verb set,
   `additionalProperties: false`), compiled by
   `scripts/lib/core/sync-transport-report-contract.js`; `pushEnvelopes` emits structured
   `proposedOps` (verb + confined paths / derived message, never shell strings) and self-validates
   fail-closed; `amber sync session push --json` surfaces the schema-valid report object.
   Note: adjudication 4's narrowed `git add` path (`.amber/sync/envelopes/` + decision record) is a
   Stage A implementation change — **narrowed as shipped in F041 (2026-08-25)**: the 1.0.0 contract's
   add op now proposes exactly `[".amber/sync/envelopes", ".amber/sync/transport/decisions"]`, the
   same pathspec set Stage A execution stages.

**Stage A shipped (F041, 2026-08-25).** `amber sync session push --execute --yes` now performs the
governed local commit (`scripts/lib/core/sync-transport.js`): the report → conflict-downgrade →
identity (non-TTY without `--yes` fails closed; TTY without `--yes` gets the F019-shaped
`approvalRequired` envelope) → policy (`rules.json` required, deny-wins over the derived add/commit
lines) → single-use approval (`amber sync session approve --reviewer <name>`, loop-ledger shape,
`latestUnconsumedApproval`) → path-and-state confinement (pre-staged index refuses — `git commit`
commits the whole index; every staged path must realpath inside the repository) → execution gates,
with every attempt (denied or executed, including failed Stage A git operations — the identity gate's
`APPROVAL_REQUIRED` exits precede an attempt and are not ledgered, per gate item 5) appended to the
hash-chained transport ledger
(`.amber/sync/transport/ledger.jsonl`, never itself staged). Execution stages exactly
`.amber/sync/envelopes` + `.amber/sync/transport/decisions` (decision records at
`.amber/sync/transport/decisions/<batchId>.json`), commits with the derived message, records the
sha, and maps nothing-to-commit to a typed idempotent outcome. `git push` is never executed,
evaluated, or proposed by the executing path — Stage B remains unimplemented and requires its own
accepted decision. The default `push` (no `--execute`) stays the byte-compatible report-only
preparation.

## Correction (2026-09-01) — identity-gate accounting and record vocabulary

The original wording in gate item 5 and the Stage A summary used `unapproved` and `failed` as if
they were transport-ledger `kind` values. They are conceptual outcomes, not record kinds emitted by
the shipped implementation. The implementation records an approval-gate refusal as
`kind: "denied"` with `gate: "approval"`, and a failed Stage A git operation as `kind: "executed"` with
`stopReason: "commit-failed"`; the other existing kinds are `approved`, `downgraded`, and
`transport-decision`.

The #296 adjudication keeps the accepted boundary unchanged (**D1**): both identity-gate exits
remain pre-attempt authorization inquiries and are deliberately not appended to the transport
ledger. If future incident evidence reopens that decision, the record shape is fixed in advance
(**D2**): use the existing `denied` kind with `gate: "identity"`, not a new record kind. The
terminology repair itself is (**D3**): describe approval refusal as `denied` + `gate: "approval"`
and commit failure as `executed` + `stopReason: "commit-failed"`, rather than inventing
`unapproved` or `failed` kinds. No schema, code, or gate behavior changes in this correction; it
makes the ADR's vocabulary match the implementation.

## Related

- [ADR-0001](0001-governance-first-artifact-first.md), [ADR-0003](0003-governance-gated-execution.md),
  [ADR-0005](0005-experimental-execution-removal.md), [ADR-0011](0011-safety-philosophy-upgrades.md),
  [ADR-0012](0012-protocol-and-schema-versioning.md), [ADR-0018](0018-governed-memory-layer.md),
  [ADR-0019](0019-distributed-governance-stage1-decisions.md)
- F035 plan: `docs/plans/F035-Harden-distributed-sync-admission-and-fail-closed-boundaries.md`
  (decision D1 and its follow-up clause)
- Implementation surfaces this ADR would touch:
  `scripts/lib/core/sync-session.js`, `scripts/lib/core/sync-remote.js`,
  `scripts/lib/core/sync-conflicts.js`, `scripts/lib/core/identity.js`,
  `scripts/lib/core/governed-runner.js`, `scripts/lib/core/loop-execution.js`,
  `scripts/lib/mcp-action-contracts.js`, `scripts/lib/memory-commands.js`,
  `scripts/lib/cli-typed-seam.js`, `scripts/lib/core/error-catalog.js`,
  `scripts/lib/command-registry.js`
- `LOOP.md` (L2: assisted execution — human approval before commit) and
  `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` §7 (approval and governed execution)
