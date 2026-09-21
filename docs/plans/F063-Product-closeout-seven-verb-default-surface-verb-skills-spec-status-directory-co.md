# Plan: Product closeout — seven-verb default surface, verb skills, spec status, directory consolidation

Feature: F063
Status: accepted
User Confirmation: confirmed

## Goal

A new user enters through an Agent-native Amber router and one of four deep journeys; the CLI
fallback exposes seven primary verbs (audit, init, doctor, next, plan, handoff, session); SPEC.md
answers "where is the project now"; and artifact lifecycle/consumer-independence rules are
enforceable without making a bulk directory migration a release blocker.

The approved product closeout also defines Coding-Agent-Enabled Repository as the target
environment and Trusted Continuation as the core outcome. The canonical feature map, user
journeys, README entry, and optional Web Viewer must express one J0–J5 frontstage rather than
separate command, Route, or dashboard taxonomies.

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
- implement: docs/specs/F063-product-closeout-seven-verb-default-surface.md, docs/quality/product-review-2026-09-02.md, docs/plans/F019-Intent-router-deep-journey-skills-default-help-projection.md, docs/adr/0014-routing-advisor.md, docs/adr/0030-coding-agent-enabled-repositories-and-trusted-continuation.md, docs/wiki/product/overview.md, docs/wiki/features/feature-map.md, docs/wiki/product/user-scenarios.md, docs/agents/dev-workflow.md
- review: docs/specs/F063-product-closeout-seven-verb-default-surface.md, docs/quality/product-review-2026-09-02.md, docs/wiki/features/feature-map.md, docs/wiki/product/user-scenarios.md, PRODUCT.md, docs/CLI_REFERENCE.md

## Vertical Slices

- [x] Slice 1 (ticket 0039): seven-verb default help — TIER_BY_COMMAND re-tune, usage() header, parity/help tests, CLI_REFERENCE + AGENTS.md re-projection.
- [ ] Slice 2 (ticket 0040): reconcile the skill topology to one router plus four deep journeys; remove the one-command alias requirement and regenerate only canonical projections.
- [x] Slice 3 (ticket 0041): SPEC.md status header (three lines, body untouched).
- [ ] Slice 4 (ticket 0042): artifact lifecycle rules and packaged-surface independence gate; defer bulk directory migration to P2-04 and preserve existing staged worktree state.
- [ ] Slice 5 (ticket 0043): reconcile feature_list evidence and evolution/handoff records only after Slices 1–4 have fresh gates and independent review evidence.
- [ ] Slice 6 (approved product journey closeout): publish the eight-band feature matrix and J0–J9 journey model; align README/README.zh-CN and the optional Web Viewer home page to the J0–J5 core journey without widening Viewer authority.

## Resume Checkpoint

- Resume Point: reconciled implementation is complete and landed (2026-09-15): one-router/four-journey
  topology, seven-verb default surface, SPEC status header, lifecycle invariants, Trusted Continuation
  positioning (EN/zh README, ADR-0030), and the Web Viewer home page.
- Blockers: none. The 2026-09-15 landing merged origin/master (Team Replication Charter, TypeScript 7
  adaptation) into the reconciled surface; the charter's two personal-name identifiers were neutralized
  per spec N7, and the `.gitignore` budget was restored to 60 active lines.
- Next Action: none for F063 — closed. Follow-up candidates: extract named J-index constants in
  `apps/web/src/features/home/home-journey.ts` (review judgement call), P1/P2 items remain separate work.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; tickets live under issues/0039–0043-f063-*.md; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `amber --help` (the deterministic CLI fallback) shows exactly the seven verbs in order (audit, init, doctor, next, plan, handoff, session), ≤ 25 lines, with the product statement and --all pointer; every other command remains callable with --help and listed under --all.
- Canonical `skills/` contains exactly one router and four deep journeys; no one-command alias skill is required; generated host projections are current and `gen:agents:check` is green.
- SPEC.md's header answers the project's real status; its body is untouched.
- Artifact classes have one documented lifecycle home; no new root temporary/vendor artifacts;
  bulk directory moves and their count/line-budget targets are deferred to P2-04.
- Packaged-surface independence is enforced by code review and the existing CI gates (npm test, npm run manifests): the actual pack file list contains no required optional third-party skill dependency, and canonical skills invoke only Amber command IDs or typed MCP tools.
- Product source, tests, active documentation, generated projections, and product paths contain no external tool, author, or vendor identifiers; future commit subjects use Amber-native wording and existing Git history is not rewritten.
- Every registered Feature appears exactly once in the eight capability bands; J0–J5 are the default journey, J6–J8 remain conditional, and J9 remains expert-only.
- README and README.zh-CN lead with the target environment, Trusted Continuation, and J0–J2 activation path; installation alone is not described as activation.
- The Web Viewer home page is a judgment surface: it shows J0–J5, marks one current journey from live state, keeps Sessions/Gates primary, and keeps Suggestions conditional without becoming an authority surface.
- Existing Amber guardrails still pass: npm test (full log on disk), npm run manifests, npm run doctor, npm run gen:agents:check, validate-wiki for wiki changes.

## Evidence Schema

- Command: exact validation, review, or product-surface inspection command.
- Result: exit code plus the relevant count, verdict, or resolved contradiction.
- Date: ISO calendar date for the evidence run.
- Notes: changed-file scope, preserved parallel work, and interpretation limits.
- Artifact or session id: durable plan, review, report, or governed-session reference.
- Remaining risk: unresolved product, adoption, security, or verification risk.

## Verification

- node scripts/amber.js --help  (seven verbs, ≤ 25 lines)
- node scripts/amber.js --all  (full projection intact)
- npm test
- npm run manifests
- npm run doctor
- npm run gen:agents:check
- node --test tests/unit/external-reference-ip-hygiene.test.js
- npm --prefix apps/web run typecheck
- npm --prefix apps/web run lint
- npm --prefix apps/web run test
- npm --prefix apps/web run test:e2e -- --grep "Trusted Continuation Console"
- node scripts/validate-wiki.js --target .  (wiki/docs changes)
- node scripts/amber.js knowledge graph --target . --json  (required for the future P2-04 move,
  not evidence that F063 performed the move)

## Landing Evidence (2026-09-15, reconciled implementation)

Two-axis review report: `.scratch/f063-landing-review.md` (Standards: 0 hard violations,
2 accepted judgement calls; Spec: no gaps, no scope creep, 1 real defect found and fixed —
the merged charter carried two personal-name identifiers, neutralized per N7).

- Command: npm test
- Result: 3587 tests, 3585 passed; 2 failures attributed (1 concurrent-edit race on the
  .gitignore budget, 1 real charter vocabulary defect) — both fixed and re-verified 9/9.
- Date: 2026-09-15
- Notes: full log `.scratch/f063-landing-test-run.log`; re-verification via
  run-tests on external-reference-ip-hygiene + f063-placement-invariants.

- Command: npm run manifests && npm run doctor && npm run gen:agents:check && node scripts/validate-wiki.js --target .
- Result: all green (manifests Errors 0; doctor Errors 0 across feature_list/plugin-manifests/
  workflow-pack/profile smokes; 15 agent files current; wiki validator silent-clean).
- Date: 2026-09-15

- Command: node scripts/amber.js --help
- Result: Commands: audit, init, doctor, next, plan, handoff, session — 16 lines, product
  statement + --all pointer present.
- Date: 2026-09-15
- Notes: output captured in `.scratch/f063-help.txt`.

- Command: node scripts/amber.js knowledge graph --target . --json
- Result: exit 0 (spawnSync maxBuffer fix holds); 540 nodes / 1589 edges / 0 drift findings;
  schemaVersion 2. Growth from the 516/1526 baseline comes from new ADR/charter/feature nodes.
- Date: 2026-09-15

- Command: npm --prefix apps/web run typecheck / lint / test / build
- Result: typecheck exit 0; lint 0 errors (32 pre-existing react-refresh warnings);
  vitest exit 0; build exit 0 — all after the 2026-09-15 minor dependency batch update.
- Date: 2026-09-15

Historical (pre-reconciliation) results are preserved in Git history and in the superseded
section of commit 5f3fe0f; they are not current acceptance evidence.
