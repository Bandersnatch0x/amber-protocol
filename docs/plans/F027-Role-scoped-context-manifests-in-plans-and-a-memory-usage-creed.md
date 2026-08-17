# Plan: Role-scoped context manifests in plans and a memory usage creed

Feature: F027
Status: accepted
User Confirmation: confirmed

## Goal

Plan scaffolds gain a Context manifests section (implement/ and review/ roles listing knowledge-surface paths only — contract docs, specs, wiki, ADRs; never code paths), validated at the plan gate (missing file or code-path entry is an error with a clear remedy) and echoed by amber review; templates/MEMORY.md gains a 'capability, not ceremony' usage creed stating what belongs in memory and an explicit when-NOT list

## High Level Design

- Context:
  - Plans carry scope and evidence, but nothing tells the implementer versus the reviewer WHICH
    knowledge surfaces they need (contract docs, specs, runbooks, ADRs). Each session
    re-discovers them or skips them, and code paths get pasted into prompts as context —
    wasting tokens and drifting from the booked feature paths.
  - Amber ships MEMORY.md/notes.md continuity surfaces with no usage boundary, so they
    accumulate ceremony (transient task state, reconstructible facts) instead of durable
    capability.
  - Verified against code: `buildPlanContent` (scripts/lib/core/planning.js) renders the
    scaffold sections Goal → High Level Design → Vertical Slices → Resume Checkpoint →
    Acceptance Criteria → Verification → Evidence Schema with no context-manifest surface
    today. `validatePlanContent` is the pure gate core — signature `{ content, resolveFeature }`,
    no filesystem — with a fixed required-sections list; `validatePlanGate` wraps it and is
    where a file-existence resolver must be injected (the resolveFeature injection is the
    precedent to copy). The review echo precedent is F026's scopeDiscipline: a structured
    block on the review result plus rendered lines in scripts/lib/core/cli-output.js (~line
    628), never touching the blocking findings computation. templates/MEMORY.md is a 3-line
    starter installed by `ensureContinuitySurfaces` (scripts/lib/continuity-surfaces.js) via
    `readTemplateOrDefault` (the template file wins over the inline legacy fallback) and
    `writeIfMissing` (init never overwrites an existing MEMORY.md).
- Proposed approach:
  1. Scaffold section: `buildPlanContent` gains a `## Context manifests` section between High
     Level Design and Vertical Slices, with two role bullets (`- implement: <fill: ...>` and
     `- review: <fill: ...>`) and one rule line (original wording): entries are
     knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs;
     code paths belong in the feature's booked paths, not here.
  2. Gate validation: `validatePlanContent` adds Context manifests to its required-sections
     rule and parses the two role lists. Each entry must (a) exist as a file in the target
     repo — checked through an injected exists-resolver wired up in `validatePlanGate`,
     mirroring the resolveFeature injection so the pure core stays disk-free and
     unit-testable, and must resolve INSIDE the target root — and (b) be a knowledge surface:
     allowed are .md and .schema.json files anywhere plus anything under docs/, schemas/, or
     standards/; anything else (code extensions such as .js/.ts/.py/go/
     rs/java/sh/c/cpp/mjs/css/html, or any path outside the allowed sets) is an error finding
     with the remedy "move code paths to the feature's booked paths". Uncurated placeholders
     or a missing role at gate time are errors (both roles must be curated before
     implementation-ready), mirroring how the unfilled scaffold already fails the gate via
     `User Confirmation: pending`. Review output echoes the curated manifests through the
     F026 scopeDiscipline pattern (structured block + rendered lines; no new blocking
     findings of its own).
  3. Memory creed (templates/MEMORY.md only — no runtime enforcement): prepend a short
     original creed block under a heading line "Memory creed — capability, not ceremony":
     a write list (durable operator preferences and corrections; decisions that reversed a
     previous decision; anything a fresh session would otherwise get wrong), a do-not-write
     list (one-off session detail; anything reconstructible from git, feature_list.json, or
     the timeline; transient task state — that belongs in notes.md for the session), and a
     closing line that memory entries should each change future behavior or be deleted.
  4. Non-goals: no runtime memory enforcement (the creed is guidance, not a gate), no
     changes to the amber context command family (ADR-0009 distillation stays separate), no
     new top-level command, no lifecycle step.
- Risks:
  - The scaffold change alters amber plan output. tests/unit/planning.test.js pins
    buildPlanContent behavior, but its assertions are inclusion-based (no full-string pin),
    so a new section does not break them; the constraint is placement — one test splits on
    `## Verification` … `## Evidence Schema`, so the new section must not land between those
    two (between High Level Design and Vertical Slices is safe). The suite's validPlanContent
    helper builds synthetic gate-valid plans without a Context manifests section, so every
    validatePlanContent case in that suite needs the helper extended with a curated section.
  - Gate strictness must not retro-break accepted plans. Verified: no test suite re-validates
    this repo's own docs/plans files through the gate (execution-readiness, governance-audit,
    and amber-next all use temp-target fixtures), so F001–F026 stay green in CI. However,
    several suites write synthetic plan files and run gate/review on them. In practice five
    needed fixture curation (tests/integration/amber-next.test.js, tests/phase-v2.test.js,
    tests/phase-v2-5.test.js, tests/phase-v4.test.js, tests/phase-v4-5.test.js — each now adds
    a minimal valid manifests section referencing docs/wiki pages every init-ed target ships);
    the remaining suites hand-write minimal plans that never gate for pass and stayed green
    (create the referenced doc file in the fixture). A manual `amber gate` on an old,
    section-less plan now fails; accepted: the gate applies at the moment a plan moves to
    implementation-ready, and old plans are not re-gated by any suite.
  - Template change: tests/unit/continuity-surfaces.test.js asserts MEMORY.md existence only
    (content-agnostic, stays green; add creed-content cases there — there is no
    tests/unit/amber-init.test.js, this is the suite covering the MEMORY.md starter). Init
    idempotency (tests/unit/init-provenance.test.js, tests/unit/init-refresh-amber-owned.
    test.js) is unaffected — writeIfMissing never overwrites. templates/ is Prettier-ignored;
    the inline legacy fallback string in scripts/lib/continuity-surfaces.js stays unchanged
    (readTemplateOrDefault prefers the template file, which always ships).
- Scope:
  - Touches `scripts/lib/core/planning.js` (scaffold section, gate manifest validation with
    injected exists-resolver, review echo data), `scripts/lib/core/cli-output.js` (manifest
    echo rendering, scopeDiscipline pattern), `templates/MEMORY.md` (creed block),
    `tests/unit/planning.test.js` (context-manifest cases + validPlanContent extension),
    `tests/unit/continuity-surfaces.test.js` (creed install cases), the synthetic plan
    fixtures listed in Risks, and docs wiring (docs/CLI_REFERENCE.md plan/gate/review notes).
  - Non-goals: no runtime memory enforcement, no changes to the amber context command family
    (ADR-0009 stays separate), no new top-level command, no lifecycle step; PUBLIC_COMMAND_ORDER
    and the breadcrumb parity walk stay untouched.

## Context manifests

Dogfood note (honest): this section is the scaffold shape F027 itself introduces — amber plan
does not render it until Slice 1 lands, and the gate learns to validate it in Slice 2. It is
included here, already curated with real repo paths, so F027's own plan is the first live
consumer of its own mechanism; until implementation, the gate treats this section as inert
content. Entries are knowledge-surface paths only; code paths belong in the feature's booked
paths, not here.

- implement: docs/specs/2026-08-15-workflow-state-breadcrumb.md, docs/specs/2026-08-15-learning-writeback.md, docs/adr/0009-contract-driven-context-distillation.md
- review: docs/dogfood-weekly.md, docs/adr/0016-deep-governance-decision-seams.md

## Vertical Slices

- [ ] Slice 1: scaffold section + memory creed — buildPlanContent gains `## Context manifests`
  (between High Level Design and Vertical Slices — never between Verification and Evidence
  Schema; the planning.test.js split test pins that window) with the two role placeholder
  bullets and the knowledge-surface-only rule line; templates/MEMORY.md gains the creed
  block. Red tests first in tests/unit/planning.test.js (section renders, placeholders and
  rule line present, placement) and tests/unit/continuity-surfaces.test.js (installed
  MEMORY.md carries the creed headings).
- [ ] Slice 2: gate validation — validatePlanContent parses both role lists and fails
  cleanly on placeholders, a missing role, or an empty section ("both roles must be curated
  before implementation-ready"); entries are checked against an injected exists-resolver
  (wired in validatePlanGate to the target repo) and the knowledge-surface rule (.md files,
  or any file under docs/, schemas/, standards/); code-extension or outside-set entries
  produce an error finding with the "move code paths to the feature's booked paths" remedy.
  Red tests first in tests/unit/planning.test.js: missing path, code file, placeholder,
  valid-docs-pass, md-outside-docs-allowed, pure-core-no-disk.
- [ ] Slice 3: review echo + fixture sweep — buildReviewResult/reviewPlan attach a
  structured contextManifests block (both roles' curated entries) and cli-output.js renders
  it in review output (scopeDiscipline pattern, no new blocking findings); extend every
  synthetic plan fixture listed in Risks with a curated manifests section whose entries
  exist in the temp target; full npm test.
- [ ] Slice 4: docs + live dogfood — CLI_REFERENCE notes for plan/gate/review; amber gate
  and amber review on THIS plan (its own curated manifests above become the live dogfood
  pass); record feature evidence via session verify.

## Resume Checkpoint

- Resume Point: implementation, tests, and docs wiring landed; two-axis reviewed (Standards
  major fixed: manifest existence resolver now contained to the target root); awaiting session
  verify --execute + accept.
- Blockers: none (user confirmation recorded via gate --confirm).
- Next Action: run the governed session lifecycle (verify --execute → approve → accept).
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- amber plan output renders the Context manifests section with the implement/review
  placeholder bullets and the knowledge-surface-only rule line; the Verification → Evidence
  Schema adjacency is untouched (pinned by tests/unit/planning.test.js).
- amber gate rejects, each with a clear remedy: a manifest entry that does not exist in the
  target repo; an entry that is a code file (code extension, or outside docs/, schemas/,
  standards/ and not .md); an uncurated placeholder or a missing role. A plan whose both
  roles list existing knowledge-surface docs passes the manifest check.
- amber review echoes the curated manifests (structured block plus rendered lines) without
  introducing blocking findings of its own.
- templates/MEMORY.md carries the "capability, not ceremony" creed — heading line, write
  list, explicit do-not-write list, closing "change future behavior or be deleted" line —
  and ensureContinuitySurfaces installs it into fresh targets while never overwriting an
  existing MEMORY.md.
- No runtime memory enforcement, no changes to the amber context command family (ADR-0009
  stays separate), no new top-level command, no lifecycle step; PUBLIC_COMMAND_ORDER and the
  breadcrumb parity walk stay untouched. Existing Amber guardrails still pass.
- npm test green (0 failed); feature_list.json survives
  `node scripts/validate-feature-list.js --target .` clean (Errors: 0) and stays
  Prettier-clean.
- Live dogfood: F027's own plan carries curated manifests for both roles, passes its gate,
  and is echoed by amber review.

## Verification

- node --test tests/unit/planning.test.js (context-manifest cases)
- node --test tests/unit/continuity-surfaces.test.js (templates/MEMORY.md creed install — the suite covering the MEMORY.md starter)
- amber gate --target <tmp> --plan <p> rejects a manifest entry that is a missing path or a code file
- amber review echoes the manifests for a filled plan
- node scripts/amber.js gate --target . --plan docs/plans/F027-Role-scoped-context-manifests-in-plans-and-a-memory-usage-creed.md
- node scripts/amber.js review --target . --plan docs/plans/F027-Role-scoped-context-manifests-in-plans-and-a-memory-usage-creed.md --json

## Evidence Schema

Planned evidence entries; record actual results and dates at verification time.

- Command: node --test tests/unit/planning.test.js
- Result: required — context-manifest cases: scaffold renders the section with role
  placeholders and the rule line; gate rejects a missing-path entry, a code-file entry, and
  an uncurated placeholder or missing role (each with a clear remedy); valid doc entries in
  both roles pass; the pure core takes an injected exists-resolver, no disk hits inside
  validatePlanContent
- Date: record at verification
- Notes: buildPlanContent pins in this suite are inclusion-based — extend rather than
  rewrite; the validPlanContent helper gains a curated manifests section

- Command: node --test tests/unit/continuity-surfaces.test.js
- Result: required — the installed MEMORY.md carries the creed headings (write list,
  do-not-write list, closing line); a second ensureContinuitySurfaces run leaves it
  untouched (writeIfMissing)
- Date: record at verification
- Notes: this is the suite covering templates/MEMORY.md install (there is no
  tests/unit/amber-init.test.js); init idempotency is separately covered by
  tests/unit/init-provenance.test.js and tests/unit/init-refresh-amber-owned.test.js

- Command: amber gate --target <tmp> --plan <p> / amber review --target <tmp> --plan <p>
- Result: required — gate errors with remedy for a manifest entry that is a missing path or
  a code file; review echoes the curated manifests for a filled plan
- Date: record at verification
- Notes: temp-target fixtures must create the referenced doc files — every entry must exist
  in the target repo

- Command: npm test
- Result: required — full repository suite green (0 failed), including the ~10 suites whose
  synthetic plan fixtures gain a curated manifests section
- Date: record at verification
- Notes: final gate before review; parity walk untouched

- Command: node scripts/amber.js gate --target . --plan docs/plans/F027-Role-scoped-context-manifests-in-plans-and-a-memory-usage-creed.md (after confirmation)
- Result: required — live dogfood: this plan's own curated manifests for both roles pass the
  new gate, and amber review echoes them
- Date: record at verification
- Notes: F027's plan is the first consumer of its own scaffold section
