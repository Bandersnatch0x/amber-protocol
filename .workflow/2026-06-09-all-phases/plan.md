# All Phases Workflow Plan

## Goal

Complete the roadmap phases in `ROADMAP.md` from the current completed V1 state through V5.5, using safe workflow packets and verification gates.

## Success Criteria

- Each roadmap phase has implemented product surface, templates, validation, tests, and documentation.
- Phase dependency gates are checked before later phases claim completion.
- Dynamic execution, worktree orchestration, subagent dispatch, publishing, and external writes are introduced only when the corresponding phase explicitly owns them and their safety gates are implemented.
- Every phase completion is recorded in this workflow directory with verification evidence.

## Current Context

- V1 Safe Harness Bootstrap is complete and verified.
- Current command surface: `init`, `audit`, `wiki`, `doctor`, `handoff`.
- V1 non-goals remain non-goals until a later phase intentionally expands the product boundary.

## Work Packets

- Packet A: V1.5 compatibility and doctor hardening.
- Packet B: V2 planning layer and human gates.
- Packet C: V2.5 standards, review, and acceptance gate.
- Packet D: V3 workflow pack design kit.
- Packet E: V4 isolated execution foundation.
- Packet F: V4.5 controlled agent orchestration.
- Packet G: V5 team distribution.
- Packet H: V5.5 continuous harness maintenance.
- Packet I: Integration, verification, and final phase audit.

## Verification

- Targeted tests for each packet.
- `npm test`
- `npm run manifests`
- External Codex plugin validation.
- Root safety check.
- Phase boundary scan matching `ROADMAP.md`.

