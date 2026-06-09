# Orchestration

## Sequence

1. Create workflow artifact.
2. Spawn read-only subagents for independent review packets.
3. While subagents run, inspect local gaps and pick a safe implementation slice.
4. Integrate subagent findings.
5. Implement the selected slice with tests.
6. Run verification and boundary checks.
7. Write final report.

## Branching Rules

- If a proposed task requires product Dynamic Workflow execution, defer it to V3+.
- If a proposed task requires automatic rewriting of old project files, rewrite it as read-only audit output or explicit patch suggestion.
- If a proposed task requires destructive filesystem or git operations, stop for approval.
- If subagent findings conflict, inspect `SPEC.md` first, then implementation and tests.

## Packet Prompts

See `packets/packet-a-backlog.md` and `packets/packet-b-coverage.md`.

## Local Critical Path

The main thread owns workflow artifacts, final integration, implementation, and verification. Subagents are sidecar reviewers only.
