# F001 Example Feature

## User-Visible Behavior

A fresh agent can understand the project, run verification, and hand off work safely.

## Scope

In:

- Customize the Harness files for this repository.

Out:

- Dynamic workflow execution.
- Subagent dispatch.
- Automatic rewriting of old project documents.

## Acceptance Criteria

- Wiki pages describe product, architecture, engineering, and agent guidance.
- `feature_list.json` has project-specific features.
- Verification command is recorded.

## Verification

1. Read `docs/wiki/index.md`.
2. Run the command in `docs/wiki/engineering/verification.md`.
3. Run the Coding Harness doctor from the toolkit repository.

## Architecture Notes

- The Harness is repository-local.
- Machine-readable state lives in `feature_list.json`.
- Stable context lives in `docs/wiki/`.

## Evidence

Record verification command output after customization.

## Open Questions

- What project-specific feature should replace this example?

## Unknowns / Needs Confirmation

- Confirm whether this example feature should be replaced, renamed, or removed.

## Unknowns / Needs Confirmation

- Confirm the project-specific feature ID, behavior, acceptance criteria, and verification evidence that should replace this example.
