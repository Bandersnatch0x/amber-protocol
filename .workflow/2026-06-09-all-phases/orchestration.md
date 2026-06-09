# All Phases Orchestration

## Loop

1. Select the earliest incomplete phase whose dependency gates are satisfied.
2. Write or update tests that express the phase gate.
3. Implement the smallest product surface that satisfies the phase without bypassing safety boundaries.
4. Update documentation, templates, and workflow records.
5. Run targeted tests, then broad verification when the phase closes.
6. Record accepted/rejected decisions in `results/`.

## Approval And Safety Gates

- No external publishing, marketplace upload, deployment, email, or remote writes without explicit approval.
- No destructive file operation against user projects.
- No automatic rewrite of existing target repo files.
- Worktree and execution features must remain isolated, inspectable, and replayable before any orchestration feature can depend on them.
- Subagent orchestration must separate worker output from reviewer evidence and must not self-approve.

## Integration Policy

- Product commands may grow after V1 only when documented by the roadmap phase being implemented.
- Later phases must preserve earlier commands and tests.
- If a phase cannot be implemented safely in this local toolkit, create validated declarative artifacts and mark the execution side as requiring external approval rather than pretending it ran.

