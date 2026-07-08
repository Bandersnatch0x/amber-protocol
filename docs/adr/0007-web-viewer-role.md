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
synchronously in the web server process (same as the CLI does). The
verification command reads the working tree and writes to the ledger; it does
not talk to the runner.

## Consequences

**Positive:** Clear, documented boundary between web actions and CLI-only
actions. The architecture doc can be corrected from "Read-Only by Default" to
"supervised action viewer" with the explicit list above. Future PRs adding new
web mutations must first check this ADR's allow list.

**Negative:** The web console has a dependency on the CLI core modules
(`evidence-runner.js`, `lifecycle.js`, `completion-check.js`). These are loaded
via `createRequire` from `server/routers/lifecycle.ts`. A breaking change to
the CLI module API could silently break the web server. This is handled by
narrow import surfaces and TypeScript types for the module interfaces.

**Neutral:** Some actions that seem natural as web buttons (`approve`,
`complete`) are intentionally withheld. This is consistent with Amber's
governance-first principle: approval requires human intentionality that a
button click in a localhost dashboard cannot credibly provide.

## Related

- ADR-0003 (governance-gated execution — the five preconditions)
- ADR-0006 (viewer is `.amber`-only — legacy state policy)
- `docs/architecture/web-viewer.md` — must be updated to reflect this ADR
- `scripts/lib/core/evidence-runner.js` — verification command execution
- `server/routers/lifecycle.ts` — web-side lifecycle + verification
- `server/routers/session-control.ts` — web-side session control
