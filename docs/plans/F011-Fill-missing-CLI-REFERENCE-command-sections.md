# Plan: Fill missing CLI_REFERENCE command sections

Feature: F011
Status: accepted
User Confirmation: confirmed

## Goal

`docs/CLI_REFERENCE.md` documents every command in the CLI's `COMMANDS` array (33 total). Today only 19 have sections; 14 are absent (wiki, plan, gate, review, accept, agent, team, adoption, status, sync, security, feature, clean, explain — `explain` appears only inside the Error Codes prose, without a heading). A user reading the reference cannot discover roughly 40% of the surface.

## High Level Design

- Context: measured during the 2026-07-28 architecture scan (3-agent decision panel). The guard/generator proposals around this file were rejected (YAGNI), but the coverage gap itself is a real documentation defect that ships to users.
- Proposed approach: hand-write the 14 missing sections, sourcing wording from the existing single sources — `scripts/lib/command-help.js` (`COMMAND_HELP` text) and `scripts/amber.js` (`PER_COMMAND_USAGE` + examples). Do not invent new behavior descriptions. Deprecated commands (agent, team, adoption) get a short section that mirrors their `--help` deprecation notice and points at the replacement, matching the existing deprecated sections' style.
- Risks: wording must stay within the docs boundary guard (`tests/unit/docs-current-boundary.test.js` — CLI_REFERENCE is on its allow list for `--mode autonomous`, and the other four banned patterns must not be introduced); `tests/amber-cli.test.js:1582` asserts CLI_REFERENCE keeps the loop-recommendation phrases — additive-only editing keeps both green.

## Vertical Slices

- [x] Slice 1: inventory the exact gap on HEAD (which of the 33 COMMANDS lack a `##`/`###` section) and confirm the 14-command list.
- [x] Slice 2: add sections for the non-deprecated missing commands (wiki incl. knowledge subcommands, plan, gate, review, accept, status, sync, security, feature, clean, explain) with usage line + description + example each.
- [x] Slice 3: add short deprecated-command sections (agent, team, adoption) mirroring their `--help` deprecation text.
- [x] Slice 4: run `npm test` to confirm the docs guards and CLI assertions stay green.

## Resume Checkpoint

- Resume Point: sections written (33/33 headings verified; docs-current-boundary green); full `npm test` pending via `session verify --execute`.
- Blockers: none.
- Next Action: start governed session, run `session verify --execute --command "npm test"`, then approve gate and accept.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- Every command in `scripts/amber.js` `COMMANDS` has a heading-level section in `docs/CLI_REFERENCE.md` (33/33).
- Section wording is consistent with `--help` output (no invented behavior).
- Existing Amber guardrails still pass (`npm test`, including docs-current-boundary and amber-cli CLI_REFERENCE assertions).

## Verification

- Run `npm test` (full suite ≈1246, includes docs boundary + CLI reference phrase guards).
- Spot-check: `grep -c "^### \|^## " docs/CLI_REFERENCE.md` and confirm each of the 14 added commands has a heading.

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
