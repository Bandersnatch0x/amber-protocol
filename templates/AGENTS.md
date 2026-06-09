# Agent Working Rules

## Project Overview

- Product goal: describe the user-visible outcome this repository serves.
- Tech stack: record runtime versions, package managers, and key frameworks.
- Key directories: list source, test, docs, scripts, and generated-output locations.

## Startup Flow

1. Read `AGENTS.md` and `CLAUDE.md`.
2. Read `PROGRESS.md` and `session-handoff.md`.
3. Read `feature_list.json`.
4. Read `docs/wiki/index.md`.
5. Read `.workflow/continuous-improvement/state.json` when continuing a goal, automation wake, or health pass.
6. Run the standard verification command recorded in `docs/wiki/engineering/verification.md`.
7. Inspect current repo state and treat pre-existing dirty files as user-owned.
8. Before editing, name the objective, files in scope, files out of scope, and verification evidence.

## Work Rules

- Work on one feature at a time.
- Keep V1 Harness behavior safe, inspectable, idempotent, and verifiable.
- Do not expand scope silently. Record adjacent issues in notes or the Wiki.
- Do not mark a feature `passing` without evidence.
- Do not run dynamic workflows, dispatch subagents, orchestrate worktrees, or route models from this Harness.
- Do not automatically overwrite or merge existing project documents.
- For recurring improvement or automation wakeups, use `docs/wiki/agent/continuous-improvement.md`.
- For ambiguous or multi-track work, use `docs/wiki/agent/workflow-packets.md`.

## Approval Gates

Ask before deleting files, running destructive git operations, changing secrets or external systems, adding or upgrading dependencies, creating migrations, broad codemods, mass renames, product-flow changes, or security-boundary changes.

## Definition Of Done

- Static checks pass.
- Unit, integration, or equivalent targeted tests pass.
- User-visible behavior is verified.
- `feature_list.json` contains evidence for passing work.
- `PROGRESS.md` and `session-handoff.md` describe the next action or blocker.
- `.workflow/continuous-improvement/state.json` is updated when a continuous-improvement loop changes queue, result notes, or active workflow state.

## Closeout Flow

1. Run standard verification.
2. Run a separate review pass against the objective and approval gates.
3. Update feature status and evidence.
4. Update `PROGRESS.md`.
5. Update `session-handoff.md`.
6. Update `.workflow/continuous-improvement/state.json` if the work came from that loop.
7. Clean temporary files and debugging output.
