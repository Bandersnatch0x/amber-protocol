# ADR-0007: Web console role — supervised action viewer

**Status:** Accepted
**Date:** 2026-07-08
**Supersedes:** Architecture doc `docs/architecture/web-viewer.md` statement
"Read-Only by Default" for the session-control surface.
**Builds on:** ADR-0003 (governance-gated execution), ADR-0006 (viewer is `.amber`-only).

---

## Context

The web viewer (`apps/web`) was originally scoped as a read-only dashboard for
visualizing Amber state. The architecture doc (`docs/architecture/web-viewer.md`)
states "Read-Only by Default" and "session controls via CLI spawn."

However, the actual implementation has already crossed this boundary in two ways:

1. **`sessionControlRouter`** (`server/routers/session-control.ts`) exposes
   `start`, `pause`, `resume`, and `abort` mutations. These write to the session
   timeline, the hash-chain ledger, and communicate with the runner via the
   runner-ack protocol (`server/lib/runner-ack.ts`). They are fully audited,
   non-arbitrary state transitions.

2. **`lifecycleRouter.runVerification`** (`server/routers/lifecycle.ts`) is a
   mutation that directly imports `evidenceRunner.runEvidenceCommand` from
   `scripts/lib/core/evidence-runner.js` and executes the verification command
   on the working copy. This is the same code path as `amber session verify
   --execute`, not a CLI spawn.

Neither of these is a casual escape hatch — both go through the same policy gate
(verify-rules.json deny-wins), the same hash-chain ledger, and the same audit
trail as their CLI equivalents. But the architecture doc's "Read-Only by
Default" claim is now false for the session-control and verification surfaces.

This ADR formally defines which actions the web console may expose and which
remain CLI-only.

## Decision

The web console is a **supervised action viewer** — it combines read-only
dashboards with a constrained set of audited, non-arbitrary mutations.

### Allowed web mutations

| Mutation | Router | What it does | Gate |
|----------|--------|-------------|------|
| `session.start` | sessionControl | Move session CREATED/ROUTED → EXECUTING | runner-ack protocol |
| `session.pause` | sessionControl | Move session EXECUTING → PAUSED | runner-ack protocol |
| `session.resume` | sessionControl | Move session PAUSED → EXECUTING | runner-ack protocol |
| `session.abort` | sessionControl | Move session → ABORTED (any non-terminal) | runner-ack protocol |
| `runVerification` | lifecycle | Run declared verify command, record exit code | verify-rules.json (deny-wins) |

All five inherit the same governance constraints as their CLI equivalents:
- Verification commands pass through `loadVerifyPolicyRules` (default-deny).
- Session state transitions are appended to the hash-chain ledger.
- Every mutation is recorded in the session timeline.

### Remaining CLI-only actions

These require human intentionality that a web button click cannot provide
under Amber's governance model:

| Action | CLI equivalence | Why web is forbidden |
|--------|----------------|---------------------|
| `gate --confirm` | Plan-level approval | Must read the plan document; confirmation is a deliberate human act |
| `approve` | Session-level approval | Identity gate (user-approval) requires `--yes` or TTY — a button click is neither |
| `complete` | State → completed | Requires complete-check to pass server-side; CLI run in repo context ensures state consistency |
| `accept --plan` | Feature acceptance | Requires reading the evolution log; modifies harness-evolution.md |
| `handoff` | Write session-handoff.md | Generates a file from live state — web console should link to the file, not regenerate it |
| `feature add/verify` | Feature management | Modifies feature_list.json — tracking a feature list is not the viewer's job |

The dividing line: **web mutations mirror existing state transitions that are
fully audited and reversible by the CLI**. Web actions may write to
`timeline.jsonl`, `ledger.jsonl`, and `manifest.json` — they may NOT create or
delete files, modify `feature_list.json`, or write handoff documents.

### Runner-ack protocol

Session-control mutations (start/pause/resume/abort) use the runner-ack protocol
(`server/lib/runner-ack.ts`). This is a coordination layer between the web
server and the CLI runner process: the web sends a control request via
`.amber/runner/control-requests/`, the runner picks it up, and the web waits
for an acknowledgement. This means session control only works when a runner is
attached to the session. Without a runner, the web can read session state but
cannot change it — the state transition would persist in the manifest but the
runner would never pick up the change. This is acceptable: the web reports the
rejection or timeout back to the user.

This is distinct from `runVerification`, which runs evidence commands
synchronously in the web server process (same as the CLI does) (superseded by
Amendment 2026-08-18 (b)). The
verification command reads the working tree and writes to the ledger; it does
not talk to the runner.

## Consequences

**Positive:** Clear, documented boundary between web actions and CLI-only
actions. The architecture doc can be corrected from "Read-Only by Default" to
"supervised action viewer" with the explicit list above. Future PRs adding new
web mutations must first check this ADR's allow list.

**Negative:** The web console has a dependency on the CLI core modules
(`evidence-runner.js`, `lifecycle.js`, `completion-check.js`). These are no
longer imported directly by the web router: `server/routers/lifecycle.ts` loads
a single deep adapter (`scripts/lib/web-adapter.js`) via `createRequire`, typed
by `scripts/lib/web-adapter.d.ts` as the SSOT. The adapter folds
`buildContext` → `inferNextStep` → `evaluateLifecycle` into
`evaluateLifecycleNext`, folds completion evaluation + formatting into
`getCompletionStatus`, and re-exports `runEvidenceCommand` (type SSOT only —
no extra runtime depth). LifecycleContext and the primitive builders are not
exported across the seam, so the web cannot recompose them. A breaking change
to the adapter surface (not the internal primitives) is what the web is pinned
to.

**Neutral:** Some actions that seem natural as web buttons (`approve`,
`complete`) are intentionally withheld. This is consistent with Amber's
governance-first principle: approval requires human intentionality that a
button click in a localhost dashboard cannot credibly provide.

## Amendment 2026-08-18 — continuity read-only seam and async verification

This amendment registers two implementation changes and one open governance
item. It does **not** alter the Decision tables above; the allowed-mutation
allow list and the CLI-only forbidden list keep their existing semantics.

### (a) Continuity router: four read-only queries

`server/routers/continuity.ts` adds four **queries** backed by the existing
`scripts/lib/web-adapter.js` seam:

| Query | Purpose |
|-------|---------|
| `continuity.handoff.status` | Handoff state (live/scaffold/missing) + bundle delivery readiness |
| `continuity.handoff.preview` | Lazily-rendered handoff markdown for display only |
| `continuity.governance.summary` | Repository governance report (decision, scores, findings, next actions) |
| `continuity.completion.nextActions` | Missing-item → next-action guidance for a session |

All four are read-only: they add **no mutations**, do not extend the allowed
web-mutation list, and do not change the CLI-only whitelist. Web surfaces
consuming them (HandoffCard, SessionCompletionWorkbench guidance, /governance
page) render CLI-only actions exclusively as copy-only command blocks —
handoff regeneration, session completion, and approval remain CLI acts.

### (b) runVerification is now an async evidence job

`lifecycle.runVerification` no longer executes the verification command
inline. Its contract is now:

- A policy denial (verify-rules deny-wins) still returns synchronously:
  `{ status: 'denied', reason, ... }`.
- An accepted run returns immediately with `{ status: 'accepted', jobId, ... }`
  and executes in a background evidence job (`server/services/evidence-jobs.ts`).
- `lifecycle.verificationJob({ jobId })` polls the job:
  `{ jobId, status: 'pending'|'running'|'denied'|'completed'|'failed'|'timeout', result?, error? }`.
- Job transitions broadcast the SSE event `evidence-job-changed`
  (`{ type, sessionId, jobId, status, timestamp }`), defined in
  `server/types/session-events.ts`.

This is an execution-mechanics change only. Governance is unchanged: the same
verify-rules policy gate (default-deny) decides admission, and the same
audit trail records the outcome — the verification result is appended to the
session timeline and the hash-chain ledger exactly as the synchronous path did.
The web UI follows the job via SSE (primary) with a polling fallback, and keeps
showing denials and outcomes in the historical result shape.

One write-surface addition is registered here as an explicit exception:
evidence job status snapshots are persisted under `.amber/tmp/evidence-jobs/`
(`server/services/evidence-jobs.ts`) so a client that loses its SSE connection
— or a server restart — can still recover a terminal job result via
`lifecycle.verificationJob`. These snapshots are tmp-scoped recovery state:
they are not audit artifacts (the audited outcome remains the timeline/ledger
append described above), they are not user documents, and they carry no
governance semantics. The exception does not alter the audit-boundary
semantics of the Decision: the web still only appends to
`timeline.jsonl` / `ledger.jsonl` / `manifest.json` for the five allowed
mutations, and still never creates/deletes user files or handoff documents.

### (c) web gate.approve vs the CLI identity gate — mitigated via reviewer audit identity

The web `gate.approve` surface and the CLI identity gate (`approve` requiring
`--yes` or a TTY, see the CLI-only table above) carried an unresolved semantic
tension: the web flow records an approval decision with confirmation steps,
while the CLI model treats approval as an identity-bound act that a button
click cannot credibly represent.

**Status: mitigated (2026-08-18).** The tension is resolved in favor of
strengthening audit identity without moving the permission boundary:

- `gate.approve` / `gate.approveAndResume` / `gate.reject` accept an optional
  `reviewer` identifier (trimmed, whitelist charset, bounded length). When
  supplied, the identifier is recorded consistently in the `.decision.json`
  `resolvedBy` field, the session timeline event, and the hash-chain ledger
  record (`approvedBy` / `rejectedBy`), so the audit chain attributes the
  decision to the real reviewer.
- When no reviewer is supplied, the decision is recorded under the explicit,
  clearly identifiable marker `web:anonymous` — the ambiguous hardcoded
  `'human'` value is no longer written by the web surface. Legacy decision
  files keep their recorded `resolvedBy` values.

The retained boundary: web approval **still does not constitute an equivalent
of the CLI identity gate**. The CLI `approve` semantics (`--yes` or TTY as the
intentionality proof) are not migrated to the web; the mitigation only makes
the existing web decision surface auditable to a real reviewer identity. A
future ADR revision (tracked in BACKLOG.md) may separately revisit web
handoff/complete write surfaces, which remain forbidden here.

## Related

- ADR-0003 (governance-gated execution — the five preconditions)
- ADR-0006 (viewer is `.amber`-only — legacy state policy)
- `docs/architecture/web-viewer.md` — must be updated to reflect this ADR
- `scripts/lib/core/evidence-runner.js` — verification command execution
- `server/routers/lifecycle.ts` — web-side lifecycle + verification
- `server/routers/session-control.ts` — web-side session control
