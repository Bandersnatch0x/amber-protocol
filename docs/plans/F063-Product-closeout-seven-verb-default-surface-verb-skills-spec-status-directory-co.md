# Plan: Product closeout — seven-verb default surface, verb skills, spec status, directory consolidation

Feature: F063
Status: reconciliation-required
User Confirmation: confirmed

## Goal

A new user enters through an Agent-native Amber router and one of four deep journeys; the CLI
fallback exposes seven primary verbs (audit, init, doctor, next, plan, handoff, session); SPEC.md
answers "where is the project now"; and artifact lifecycle/consumer-independence rules are
enforceable without making a bulk directory migration a release blocker.

## High Level Design

- Context: the 2026-09-02 product review (docs/quality/product-review-2026-09-02.md) diagnosed
  that the two-week trust-infrastructure wave (F049–F062) landed without a user entry: default
  help is a wall of 35 commands, the skills surface requires understanding "journeys" first,
  SPEC.md still says "draft v1", and the repository layout maps every harness ever connected
  (16 root tracked .md files, 24 docs first-level entries, 116-line .gitignore, a tracked zip,
  a case-duplicate agents.md).
- Proposed approach: five tickets — T1 re-tunes TIER_BY_COMMAND (the F019 single visibility
  source, data not mechanism) so the CLI fallback projects exactly the seven verbs and usage()
  gains a product-positioning line and --all pointer; T2 preserves exactly one router plus four
  deep journey skills (no one-command aliases); T3 adds a status header to SPEC.md without
  rewriting its body; T4 adopts artifact-lifecycle and packaged-surface independence gates while
  deferring bulk directory migration to P2-04; T5 registers the feature only after fresh evidence,
  independent two-axis review, and spec compliance.
- Risks: (1) tier re-tuning changes what scripts see in default help — mitigation: hidden
  commands remain fully callable and --all keeps the complete projection, and the parity test's
  derivation invariant is untouched; (2) generated projections can retain the superseded thin
  aliases — mitigation: test the exact canonical source set and regenerate all host projections;
  (3) a later P2-04 move can orphan references or knowledge-graph anchors — mitigation: require a
  clean-worktree migration plan, full-repo reference sweep, corpus regeneration, and graph check
  in that separate slice.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/F063-product-closeout-seven-verb-default-surface.md, docs/quality/product-review-2026-09-02.md, docs/plans/F019-Intent-router-deep-journey-skills-default-help-projection.md, docs/adr/0014-routing-advisor.md, docs/wiki/product/overview.md, docs/agents/dev-workflow.md
- review: docs/specs/F063-product-closeout-seven-verb-default-surface.md, docs/quality/product-review-2026-09-02.md, docs/CLI_REFERENCE.md

## Vertical Slices

- [x] Slice 1 (ticket 0039): seven-verb default help — TIER_BY_COMMAND re-tune, usage() header, parity/help tests, CLI_REFERENCE + AGENTS.md re-projection.
- [ ] Slice 2 (ticket 0040): reconcile the skill topology to one router plus four deep journeys; remove the one-command alias requirement and regenerate only canonical projections.
- [x] Slice 3 (ticket 0041): SPEC.md status header (three lines, body untouched).
- [ ] Slice 4 (ticket 0042): artifact lifecycle rules and packaged-surface independence gate; defer bulk directory migration to P2-04 and preserve existing staged worktree state.
- [ ] Slice 5 (ticket 0043): reconcile feature_list evidence and evolution/handoff records only after Slices 1–4 have fresh gates and independent review evidence.

## Resume Checkpoint

- Resume Point: implementation contains an earlier thin-skill/layout interpretation; reconcile the canonical product map before claiming completion.
- Blockers: scope reconciliation, fresh two-axis review, and spec-to-code-compliance evidence (the existing ticket logs are not sufficient proof).
- Next Action: finish the one-router/four-journey implementation (package-independence is
  enforced by review + CI, not a dedicated module), run
  fresh gates and independent reviews, then reconcile T5 landing records against those results.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; tickets live under issues/0039–0043-f063-*.md; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `amber --help` (the deterministic CLI fallback) shows exactly the seven verbs in order (audit, init, doctor, next, plan, handoff, session), ≤ 25 lines, with the product statement and --all pointer; every other command remains callable with --help and listed under --all.
- Canonical `skills/` contains exactly one router and four deep journeys; no one-command alias skill is required; generated host projections are current and `gen:agents:check` is green.
- SPEC.md's header answers the project's real status; its body is untouched.
- Artifact classes have one documented lifecycle home; no new root temporary/vendor artifacts;
  bulk directory moves and their count/line-budget targets are deferred to P2-04.
- Packaged-surface independence is enforced by code review and the existing CI gates (npm test, npm run manifests): the actual pack file list contains no required optional third-party skill dependency, and canonical skills invoke only Amber command IDs or typed MCP tools.
- Product source, tests, active documentation, generated projections, and product paths contain no external tool, author, or vendor identifiers; future commit subjects use Amber-native wording and existing Git history is not rewritten.
- Existing Amber guardrails still pass: npm test (full log on disk), npm run manifests, npm run doctor, npm run gen:agents:check, validate-wiki for wiki changes.

## Verification

- node scripts/amber.js --help  (seven verbs, ≤ 25 lines)
- node scripts/amber.js --all  (full projection intact)
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check
- node --test tests/unit/external-reference-ip-hygiene.test.js
- node scripts/validate-wiki.js --target .  (wiki/docs changes)
- node scripts/amber.js knowledge graph --target . --json  (required for the future P2-04 move,
  not evidence that F063 performed the move)

## Historical Evidence (superseded by reconciliation)

The following results predate the approved one-router/four-journey and P2-04 scope correction.
They are retained as historical execution records, not current F063 acceptance evidence. Replace
them with fresh results after the reconciled implementation is complete.

- Command: npm test
- Result: 3542 passed, 0 failed, exit 0 (full log .scratch/f063-npm-test-final3.log)
- Date: 2026-09-03
- Notes: Full-suite rerun after the prettier-contract test repair (both affected tests now pin --config .prettierrc.json; previously they passed only because the old .gitignore made prettier skip the fixture).
- Command: npm run manifests && npm run doctor && npm run gen:agents:check && node scripts/validate-wiki.js --target .
- Result: all green (manifests errors 0; doctor errors 0; 24 generated files current; wiki errors 0)
- Date: 2026-09-03
- Notes: -
- Command: node scripts/amber.js knowledge graph --target . --json
- Result: 516 nodes / 1526 edges / 0 drift findings; byte-stable double build
- Date: 2026-09-03
- Notes: Baseline before the moves was 516/1525; node count preserved, +1 edge from the new F063 feature node's anchors. Corpus regenerated through the governed knowledge context-sync path (39 unchanged, 9 accepted).
- Command: node scripts/amber.js --help
- Result: Commands: audit, init, doctor, next, plan, handoff, session — 16 lines, product line + --all pointer present
- Date: 2026-09-03
- Notes: All 47 demoted commands remain callable with --help and listed under --all.
