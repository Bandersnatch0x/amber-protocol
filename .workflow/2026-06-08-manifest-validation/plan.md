# Manifest Validation Workflow

## Goal

Implement local structural validation for Coding Harness plugin manifests.

## Success Criteria

- A local validator checks `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json`.
- Invalid manifest fixtures fail clearly.
- Unified CLI exposes the validator without expanding the V1 product boundary.
- README and BACKLOG reflect the completed slice.
- Full verification passes.

## Current Context

- V1 command surface is `init`, `audit`, `wiki`, `doctor`, and `handoff`.
- Manifest validation is listed as V1 acceptance.
- Existing plugin manifests are intentionally minimal and local.

## Constraints

- Do not publish, install, or mutate external plugin state.
- Do not add Dynamic Workflow execution, product subagent orchestration, worktree orchestration, model routing, or automatic rewrite of old project files.
- Keep plugin adapters thin.

## Risks

- Codex and Claude plugin schema assumptions may drift.
- Over-strict validation could reject intentionally minimal local manifests.
- README could imply platform certification rather than local structural validation.

## Approval Required

No approval needed for local non-destructive files and tests.

## Work Packets

- Packet A: Inspect current manifests and decide minimal local schema.
- Packet B: Add tests and bad fixtures.
- Packet C: Implement validator and CLI integration.
- Packet D: Update docs/backlog and verify.

## Verification

- `npm test`
- Existing Codex plugin validation script
- CLI smoke for manifest validation success/failure
- V1 boundary scan
