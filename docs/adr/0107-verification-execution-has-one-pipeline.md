# ADR-0107: Verification Execution Has One Pipeline

**Status:** Accepted (2026-11-03)
**Date:** 2026-11-03
**Builds on:** [ADR-0004](0004-evidence-grade-verification.md) (evidence-grade verification),
[ADR-0007](0007-web-viewer-role.md) (the web console's role and its adapter seam)

---

## Context

Two implementations of "run a verification command and write the evidence" existed at once.

| Surface | Module | Spawn |
| --- | --- | --- |
| CLI (`session verify --execute`) | `scripts/lib/core/evidence-runner.js` | `spawn` with `shell: false` over `parseGovernedArgv` |
| Web console (`lifecycle.runVerification`) | `apps/web/server/services/evidence-jobs.ts` | `spawn` with `shell: true` |

The web copy was justified when it was written: the CLI runner was `spawnSync`, which is fine for
a short-lived CLI process and unacceptable for a server whose event loop must keep serving. That
justification expired on 2026-10-11, when `924284b7` (#346) moved the CLI runner to async `spawn`.
`evidence-jobs.ts` was last touched 2026-08-22 and nothing connected the two facts.

With the reason gone, only the cost remained. The web copy re-declared `STDOUT_CAP`/`STDERR_CAP`,
its own process-tree kill, and its own ledger-record literal, and had already diverged on the one
detail that matters most: it handed the command text to a shell while the CLI executed the parsed
argv. Both surfaces ran the *same* policy verdict (`evaluateVerifyPolicy`) first, so the divergence
never widened the allowed set — `parseGovernedArgv` refuses `; | & > < \`` and `$` outright — but a
reader could not tell that from either file. The two were aligned by a comment, not by code.

## Decision

1. **`runEvidenceCommand` in `scripts/lib/core/evidence-runner.js` is the only implementation** of
   the verification pipeline: policy gate, spawn mode, output caps, budget kill, and the
   hash-chained ledger record.
2. **Verification commands run as argv with `shell: false`, on every surface.** A command that
   needs a shell is refused by the policy gate; no caller silently grants one.
3. **The web console executes through `web-adapter`'s re-export of that function.** Its job service
   owns only what is genuinely the web's: accepting a job instead of blocking a mutation, the job
   table, disk persistence, SSE notification, and the session timeline / stage-completion writes
   that follow a settled command.
4. **The runner reports `timedOut` and the resolved `budgetMinutes`.** A caller must be able to tell
   a budget kill from an ordinary non-zero exit without re-deriving the deadline.
5. **The budget's flag contract is validated at the boundary, not in the runner.** `--budget-minutes`
   stays an integer in [1, 60] (`resolveBudgetMinutes`); the runner accepts any positive finite
   duration, because a programmatic caller may legitimately ask for a sub-minute budget.

## Rationale

- **Evidence is only verifiable if both surfaces write the same record.** Two implementations of one
  record shape is a drift generator with no natural stopping point: the next fix lands in one of them.
- **The deletion test passes.** Deleting `spawnEvidenceCommand` moves no complexity into the web —
  it concentrates in a module both surfaces already call, behind one interface. Nothing about job
  control, persistence, or session audit needed to move with it.
- **The seam has two adapters, so it is real.** The CLI and the web job service are genuinely
  different callers (one blocks, one accepts and polls) sharing one execution contract; this is not
  one hypothetical adapter dressed up as a seam.
- **`shell: false` narrows nothing.** The policy gate runs first and refuses composition; running the
  parsed argv is the stricter reading of the same decision.

## Consequences

- `apps/web/server/services/evidence-jobs.ts` drops its execution layer (~180 lines: the spawn
  wrapper, the tree kill, and the duplicated caps). Its remaining job is orchestration.
- `tests/unit/web-adapter-seam-guard.test.js` fails if the evidence job service imports
  `child_process` again, so the second pipeline cannot quietly grow back.
- The web job now honors `AMBER_VERIFY_BUDGET_MINUTES` and refuses a non-positive budget instead of
  passing it to `setTimeout` (which would fire immediately).
- A budget kill signals `SIGTERM`, then `SIGKILL` after a two-second grace. This preserves the
  CLI's behaviour for commands that exit on `SIGTERM` and restores the guarantee the web copy had
  (it killed with `SIGKILL` outright): a command cannot outlive its budget by ignoring the signal.
- Web-written and CLI-written verification records are now shape-identical by construction, not by
  parallel maintenance.
