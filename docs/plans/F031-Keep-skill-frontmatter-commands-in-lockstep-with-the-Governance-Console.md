# Plan: Keep skill frontmatter commands in lockstep with the Governance Console

Feature: F031
Status: implemented-pending-verification
User Confirmation: confirmed

## Goal

Every shipped Amber skill names a real Governance Console command, and generated-agent validation fails when a skill invents or stales that command

## High Level Design

- Context:
  - GitHub issue #128 requires every shipped skill's `x-amber-json.command` to
    name an invocation accepted by the Governance Console; today generation
    verifies mirror drift but does not prove that command contract.
  - `skills/*/SKILL.md` is the authored source of truth, while
    `scripts/lib/command-registry.js` is the source of truth for supported
    Console commands. A second command allowlist would create another source
    of truth and is explicitly excluded.
  - Per ADR-0014, the router stays advisory: `amber next --objective` remains
    the only Journey matcher and must not be replaced with an invented fifth
    Journey or an implicit mutating Session start.
- Proposed approach:
  1. Add a tracer-bullet test at the existing agent-command generation/check
     interface showing that a skill with a stale or invented command fails
     before generated products are accepted.
  2. Deepen the existing `agent-commands` module: parse each canonical skill's
     machine command using its current frontmatter parser, validate the command
     shape against the existing Command definitions/subcommand knowledge, and
     return one deterministic validation result to generation/check callers.
  3. Make `gen:agents:check` fail on contract errors, prove every shipped skill
     passes, and document the lockstep invariant at the two existing knowledge
     surfaces.
- Risks:
  - Executing skill commands to validate them could mutate repositories; the
    validator must remain pure and registry-backed.
  - A duplicate allowlist or hand-maintained Journey catalog would drift from
    the Governance Console and fail the deletion test for a deep module.
  - Placeholder substitution and command-family subcommands must be parsed
    without weakening rejection of stale top-level commands.
  - Scope must not expand into skill prose rewrites, live-agent dispatch, or
    Journey routing-policy changes.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/wiki/knowledge/skills-platform-generation/skills-platform-generation.md, docs/wiki/knowledge/cli-architecture-command-dispatch/cli-architecture-command-dispatch.md, docs/adr/0014-routing-advisor.md
- review: docs/wiki/knowledge/skills-platform-generation/skills-platform-generation.md, docs/wiki/knowledge/cli-architecture-command-dispatch/cli-architecture-command-dispatch.md, docs/adr/0014-routing-advisor.md

## Vertical Slices

- [x] Slice 1: through the existing generator/check seam, add a failing test
  proving an invented or stale skill command is rejected without writing
  generated files.
- [x] Slice 2: implement registry-backed command-contract validation inside the
  existing `agent-commands` module, with no second command allowlist and no
  command execution.
- [x] Slice 3: prove the four shipped Journey/router contracts remain valid,
  including `amber next --objective` as the sole matcher, and wire the failure
  into `gen:agents:check`/CI.
- [x] Slice 4: update the two stable knowledge surfaces, run focused and full
  verification, and complete independent Standards/Spec review.

## Resume Checkpoint

- Resume Point: F031 implementation is in the working tree on Session
  `08729f11-77e5-4a20-8f63-036678043135` at base commit `37dd369`. Command
  contract validation lives in `agent-commands` and consumes
  `commandInvocationContract()` from `command-registry`. Dual-axis review is
  clean after wiki ownership and skill-count corrections. Session status is
  still `created`; verification and approval are missing.
- Blockers: none for implementation. Next gates are Session approval and
  executed `npm test` evidence. Unrelated web-viewer WIP is also dirty and
  must be preserved, not mixed into F031.
- Next Action: approve the two feature-standard Session gates, then record
  executed verification with `session verify --execute --confirm`.
- Recovery Instructions: reopen this plan and continue at the first unchecked
  vertical slice; if all slices are checked, resume at Next Action. Do not
  regenerate unless the plan file is missing.

## Acceptance Criteria

- Every canonical Amber skill with `x-amber-json` names a real Governance
  Console invocation accepted by the current Command definitions.
- An invented top-level command or stale command-family invocation fails
  generation check deterministically and does not write generated products.
- The router still uses `amber next --objective` as the sole Journey matcher;
  no fifth Journey, implicit Session start, or live-agent execution is added.
- Command truth remains centralized in `command-registry`; the implementation
  introduces no duplicate allowlist or shallow pass-through module.
- Existing generated outputs remain reproducible and all Amber guardrails pass.

## Verification

- node --test tests/unit/agent-commands.test.js tests/unit/command-registry-parity.test.js
- npm run gen:agents:check
- node scripts/validate-feature-list.js --target .
- npm test

## Evidence Schema

- Command: `node --test tests/unit/agent-commands.test.js tests/unit/command-registry-parity.test.js`
- Result: 56 passed, 0 failed (exit 0)
- Date: 2026-08-18
- Notes: focused suite covers invented/stale commands, undocumented and
  missing options, value-domain and required-option projection, default
  actions, nested and slash-separated subcommands, unused declared args, and
  the five shipped skill contracts. Session:
  `08729f11-77e5-4a20-8f63-036678043135`. Remaining risk: full `npm test` and
  Session verification are not yet recorded.

- Command: `npm run lint`, `npm run format:check`, `npm run gen:agents:check`,
  `npm run manifests`, `npm run doctor`, `node scripts/validate-wiki.js --target .`,
  `node scripts/validate-feature-list.js --target .`
- Result: all exit 0; 15 generated files current; zero validation errors
- Date: 2026-08-18
- Notes: static guardrails pass on the mixed working tree. Artifact: this
  plan. Session: `08729f11-77e5-4a20-8f63-036678043135`. Remaining risk:
  unrelated web-viewer WIP remains uncommitted beside F031.

- Command: Standards / Spec independent review of the F031 WIP against
  baseline `37dd369fabd49eddacea96474529e5e9540259ae`
- Result: first pass Standards 2 hard wiki findings (invented 10-skill tree;
  dual Command-definition owner plus "generated frontmatter" wording); Spec 0
  findings. After wiki/booking fixes, Standards 0 remaining hard findings;
  Spec 0 findings.
- Date: 2026-08-18
- Notes: residual judgement calls are long `validateSkillCommand`,
  `knownSubcommands` help union, dual command-string parsers, and help/usage
  projection being stricter than `parseArgs` defaults. Artifact: this plan.
  Session: `08729f11-77e5-4a20-8f63-036678043135`. Remaining risk: Session
  approval and executed full-suite verification are still open.
