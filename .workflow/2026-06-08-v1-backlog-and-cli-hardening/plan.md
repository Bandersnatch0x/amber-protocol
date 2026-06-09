# V1 Backlog And CLI Hardening Workflow

## Goal

Organize the remaining V1 work for Coding Harness and advance the next safe implementation slice.

## Success Criteria

- Remaining V1 tasks are captured as prioritized, actionable backlog items.
- At least one next V1 implementation slice is advanced with tests.
- Subagent findings are integrated explicitly.
- V1 boundary remains intact: no Dynamic Workflow execution, no product subagent orchestration, no worktree/model routing, and no automatic rewrite of old project files.

## Current Context

- Core templates, validators, skills, tests, and plugin manifests exist.
- Unified CLI exists at `scripts/harness.js`.
- Current product command surface is `init`, `audit`, `wiki`, `doctor`, and `handoff`.
- The repository is not currently a git repository.

## Constraints

- Keep plugins thin; repeatable behavior belongs in scripts and templates.
- Default behavior must not overwrite existing project files.
- Audit remains read-only.
- Workflow/subagent usage in this run is an engineering method, not a V1 product feature.

## Risks

- Documentation can accidentally overclaim future workflow support.
- CLI behavior can drift from the V1 command surface in `SPEC.md`.
- Validators can miss important malformed Harness states.
- JSON output shape can become hard to consume if left implicit.

## Approval Required

No approval needed for local non-destructive edits in this repository.

Approval is required before destructive cleanup, mass renames, publishing, external writes, or irreversible git operations.

## Workflow Artifact Path

`.workflow/2026-06-08-v1-backlog-and-cli-hardening/`

## Work Packets

- Packet A: V1 backlog and boundary review.
- Packet B: CLI and validator coverage review.
- Packet C: Local implementation slice selected after initial review.
- Packet D: Integration and verification.

## Integration Policy

Subagent findings are treated as proposals. The main thread inspects authoritative files before accepting changes and records accepted/rejected items in `final-report.md`.

## Verification

- `npm test`
- Codex plugin validation via `plugin-creator/scripts/validate_plugin.py`
- Unified CLI smoke: `init` then `doctor` against a temporary target
- V1 boundary scan for dynamic workflow/subagent/worktree overclaims

## Reusable Artifacts

If this workflow shape remains useful, summarize it later as a recipe. Do not store bulky logs or transcripts.
