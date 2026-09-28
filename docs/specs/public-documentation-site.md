---
type: spec
title: Public Documentation Site implementation specification
description: The decision-complete contract for Amber Protocol's independent, static-first Public Documentation Site — public corpus, reader journeys, generated reference, verification seam, and first-release boundaries.
status: accepted
date: 2026-09-28
method: synthesis of closed decisions (tickets 0013–0023) → user-confirmed seam
tags: [documentation, public-docs, docusaurus, acceptance, verification]
---

# Public Documentation Site implementation specification

> Provenance: this specification was authored in the local tracker as
> `issues/0024` and materialized here on 2026-09-28 (issues/0024, adjudicated
> under issues/0139) so the decision-complete contract lives with the other
> `docs/specs/` records rather than only in the local issue store. The
> implementation (the Docusaurus site under `apps/docs/` and its 12-gate
> verifier `scripts/verify-public-docs.js`) is present and mechanically
> verified (`npm run docs:verify` = 12/12). Layer-1 acceptance rows 8 and 9 are
> real mechanical gates (issues/0063); rows 7 and 10 depend on a browser+axe CI
> decision, and the Layer-2 reader trials remain human (issues/0062).

## Problem Statement

Amber Protocol has reached a decision-complete point for an independent Public Documentation Site, but the decisions are distributed across research, architecture, prototype, governance, acceptance, migration, design-system, and version-observability tickets. An implementation agent needs one coherent contract that explains what the site is for, which corpus is public, how the reader journey works, where generated reference content comes from, how the site is validated, and which tempting capabilities must remain outside the first release.

From a reader's perspective, the current repository contains useful material but is not itself a reader-oriented publication. A maintainer of a Coding-Agent-Enabled Repository must be able to decide whether Amber fits, install it safely, prove a first Trusted Continuation on real work, and understand Amber's non-execution boundary. An experienced operator must be able to locate exact commands quickly. Both outcomes must remain possible without exposing internal governance state, historical drafts, private research, or unstable repository structure.

## Solution

Build an independently deployable, static-first Public Documentation Site with one public-docs build and verification seam.

The seam consumes a curated public-corpus manifest, the existing command registry, repository release metadata, and the accepted design and acceptance contracts. It produces the static site, local search index, generated CLI and version references, and replayable verification evidence. The build and verification seam is the only integration boundary required between authored content, generated reference content, and publication.

The site is organized by reader intent rather than by the repository directory tree. It has one primary adoption path, secondary paths for experienced operators and contributors, clear navigation context, deep links, local search, code copying, responsive behavior, light and dark themes, editing links, and basic SEO. It remains separate from the local Web Viewer and from the target repository Wiki.

## User Stories

1. As a first-time developer evaluating Amber Protocol, I want to understand what Amber is and is not, so that I can decide whether it fits my workflow within a few minutes.
2. As a first-time developer, I want the site to state that Amber Core is repository-local and governance-first, so that I do not mistake it for a hosted agent runtime.
3. As a first-time developer, I want the site to explain that Amber does not autonomously execute target-repository work or dispatch live agents, so that the safety boundary is clear before installation.
4. As a first-time developer, I want a short J0–J2 path from product fit through safe adoption to a first Trusted Continuation, so that setup is connected to a real outcome rather than treated as activation by itself.
5. As a first-time developer, I want to see the supported Node and npm expectations, so that I can prepare a compatible environment before running commands.
6. As a first-time developer, I want to follow J0 `audit`, J1 `init`/`doctor`, and a real J2 goal through `next`, plan/session state, and `handoff`, so that a fresh context can continue one correct step without the old chat.
7. As a first-time developer, I want each step to explain its expected artifact or signal, so that I can distinguish safe setup, successful execution, and genuine Trusted Continuation.
8. As an experienced operator, I want to search for an exact Amber command and land on an authoritative reference entry, so that I can act without browsing the repository tree.
9. As an experienced operator, I want command syntax, options, examples, failure behavior, and scope boundaries together, so that I do not infer unsafe behavior from an incomplete snippet.
10. As an experienced operator, I want CLI reference content to reflect the command registry, so that command names and usage do not silently drift from the product.
11. As a reader, I want global navigation, section navigation, page contents, breadcrumbs, and previous/next links to work together, so that I can browse, jump, and recover context.
12. As a reader following a deep link, I want the page to expose its heading and location, so that the link remains understandable when opened without surrounding navigation.
13. As a reader, I want code examples to have an accessible copy action and preserve the complete command context, so that copied commands are usable and auditable.
14. As a reader on a narrow screen, I want navigation groups, page contents, and search to remain reachable without page-level horizontal overflow, so that the site remains usable on a phone.
15. As a keyboard user, I want visible focus, stable focus order, reachable controls, and no fixed navigation chrome covering the content, so that I can complete the same reading and search tasks without a pointer.
16. As a reader, I want light and dark themes to preserve meaning, code readability, focus visibility, and hierarchy, so that theme choice does not remove information.
17. As a privacy-conscious reader, I want search to use a build-time local index, so that normal documentation use does not send queries or page behavior to a third party.
18. As a reader using a current Amber release, I want a clear current-version stamp and support matrix, so that I can tell which commands and environment assumptions the page describes.
19. As a reader using an older Amber release, I want curated version-history and migration notes, so that I can understand relevant changes without requiring a multi-version site in the first release.
20. As a maintainer, I want version stamps and compatibility facts to derive from repository release metadata, so that manually duplicated version badges cannot become a second source of truth.
21. As a maintainer, I want breaking changes to be recorded in a central version-history surface and linked from affected guidance, so that migration advice is discoverable without copying stale notes into every page.
22. As a content owner, I want only reviewed entries from the curated public corpus to enter navigation and builds, so that internal governance records, research, drafts, runtime state, and sensitive material are excluded by default.
23. As a content contributor, I want an explicit distinction between hand-written explanation and generated reference, so that I know which material may be edited and which material must be regenerated.
24. As a content contributor, I want the existing ownership and review process to govern public documentation changes, so that publication does not create a parallel governance system.
25. As a release owner, I want documentation publication to be decoupled from package version tags while still showing the canonical package version, so that documentation fixes and product releases can be reviewed independently.
26. As a release owner, I want the build to fail closed on a missing page, broken internal link, bad anchor, generated-reference drift, or secret-like content, so that a visually plausible but incomplete site cannot publish.
27. As a reviewer, I want the site build to produce deterministic evidence about the selected corpus, generated references, page count, links, index, and version metadata, so that acceptance can be replayed.
28. As a product owner, I want the first-release user outcomes to be tested through two explicit reader scenarios, so that mechanical green checks are not mistaken for proof of adoption success.
29. As a maintainer, I want scheduled checks to detect build, link, index, or endpoint failure after publication, so that a site can be found broken even when no code change is being merged.
30. As a reader, I want a visible route for reporting broken or misleading documentation, so that reader reports can supplement automated health checks without tracking reader behavior.
31. As a privacy owner, I want any future request for usage analytics to require a new privacy decision, so that zero-telemetry remains the default rather than an accidental temporary state.
32. As a repository maintainer, I want the documentation site to remain independent from the local Web Viewer and target-repository execution boundaries, so that documenting Amber does not expand Amber's authority.

## Implementation Decisions

- The implementation has one highest-level seam: a public-docs build and verification boundary. Content selection, generated references, design tokens, version metadata, and acceptance checks enter and leave through this boundary.
- The publication is an independent Docusaurus-based site using the version and Node compatibility decision already made by the architecture ticket. The exact dependency version must be revalidated and pinned at implementation time against the supported CI matrix.
- The site is static-first and intended for GitHub Pages. Build output is the publication artifact; preview uses a CI artifact rather than an unreviewed deployment environment.
- The public corpus is governed by an explicit curated manifest. The repository docs directory is migration input, not an automatic publication tree. A-layer material may enter the first release after review; B-layer material is rewrite input only; C-layer and internal material are excluded from public navigation.
- The first migration has no public-site redirect burden because no prior public documentation site was found. Existing repository files remain in place; migration does not delete or merge them merely to simplify the new site.
- The command registry remains the authoritative command vocabulary. CLI reference pages are generated or generation-bound, carry a version identity, and fail publication when the committed reference differs from a fresh generation.
- The repository package manifest's version and declared environment engines are the source for the reader-facing version stamp and support matrix. The build does not require a live registry request to produce correct documentation.
- Version history is a curated current-version-plus-migration-notes surface. The first release does not include a reader-selectable multi-version switcher. Retired contradictory hand-written CLI references are not republished.
- Search uses a build-time local index. Normal search and page viewing have no third-party analytics or behavior telemetry.
- The design system is token-first with a small docs-local component layer for navigation, code blocks, notices, search, and pagination. It is not a full custom component system and is not a shared UI package with the local Web Viewer.
- The minimum public brand expression is an Amber mark or wordmark, an Amber accent, code-block styling, and paired light/dark theme tokens. External workflow-framework prior art supplies reading-pattern reference only; its brand narrative is not copied.
- Narrow-screen behavior is contractual: no page-level horizontal overflow; the group tree is a contained scrollable or collapsible region; page contents and search remain reachable; fixed chrome cannot obscure content; interactive targets are at least 44px; code blocks may scroll locally; keyboard focus order remains usable.
- Accessibility checks in the first release are mechanical floors for focus, structure, reachability, and layout. They do not claim WCAG conformance, screen-reader coverage, real-device coverage, or contrast certification without separate evidence.
- Publication ownership and contribution use the existing repository owner, CODEOWNERS, contribution guidance, and pull-request review. The site does not create a parallel approval or governance layer.
- Publication may be triggered independently of package version tags, but generated version identity must match repository release truth. Rollback belongs to the existing owner process; removing a page does not imply removal from external indexes.
- The mechanical acceptance contract is zero-tolerance for build failure, page-count mismatch, broken links or anchors, generated drift, C-layer leakage, secret-like content, missing version identity, and missing required navigation or editing metadata.
- The user-result acceptance contract has two replayable manual scenarios: a new reader completes J0–J2, can state Amber's non-execution boundary, and hands the real task to a fresh context that takes one correct next step without the old chat; an experienced reader finds three exact commands through search without relying on the page tree.
- Health observation combines change-triggered CI, scheduled CI re-runs for build/link/index checks, and a lightweight published-endpoint availability probe. Reader reports remain a fallback signal. Usage analytics are excluded.
- Any change to the out-of-scope list, multi-version policy, telemetry posture, or shared-application boundary requires a new decision rather than an implementation-side override.

## Testing Decisions

- Tests verify externally observable publication behavior and evidence, not the internal organization of the site components.
- A corpus test must prove that only the curated allowlist is navigable and that excluded classes cannot enter output through an accidental directory walk, link, import, or generated page.
- A content-safety test must detect absolute local paths, credential-like material, sensitive runtime state, and internal-only governance or research material before publication.
- A generated-reference test must regenerate the CLI surface from the command registry and fail on any diff, missing command, stale version identity, or mismatched usage contract.
- A compatibility test must compare the published support matrix and version stamp with repository release metadata and must reject manually divergent values.
- A build-output test must assert successful static generation, exact expected page count, required navigation surfaces, local search-index presence, editing metadata, theme metadata, and basic SEO metadata.
- A link and anchor test must report zero broken internal links, zero broken deep links, and zero missing anchors, including links used by previous/next navigation and generated reference pages.
- A responsive behavior test must exercise the narrow-screen acceptance floor: no page-level overflow, reachable search and contents controls, non-overlapping fixed chrome, local code-block scrolling, and usable focus order.
- A keyboard and structure test must inspect landmarks, heading progression, accessible names for interactive controls, visible focus, and navigation reachability. It must not overclaim WCAG compliance.
- A version-history test must verify that the current-version surface links to curated migration notes and that no reader-facing multi-version switcher appears in the first-release output.
- A privacy test must verify that normal build, search, and page-view code contains no third-party analytics or behavior tracking and that future analytics proposals are treated as a new decision.
- The two reader-result scenarios are acceptance tests at the highest useful seam: they exercise the published site as a reader would, record the exact starting state and steps, and preserve evidence of the outcome rather than testing component internals. The first scenario fails if it proves only installation, `doctor`, or Session creation without a fresh-context continuation.
- Scheduled health checks must replay the same build, link, index, and endpoint checks without collecting reader identity or behavior data.
- Prior art is the repository's existing deterministic command registry, manifest validation, Wiki validation, generated-surface checks, CI matrix, and browser-based prototype verification. New tests should plug into those seams rather than duplicate their authority.

## Out of Scope

- A multi-version reader switcher or version-specific parallel site trees in the first release.
- AI question answering, an interactive playground, comments, accounts, reader personalization, or reader behavior analytics.
- A hosted runtime, server-side application behavior, dynamic agent execution, target-repository command execution, or integration with the local Web Viewer.
- Sharing UI code or installation dependencies with the local Web Viewer.
- Treating the repository docs directory as a public mirror or publishing internal research, reviews, runtime status, governance ledgers, historical drafts, or sensitive material unchanged.
- Buying a domain, creating a production deployment, or performing an external publication action as part of this specification.
- Deleting or merging repository documentation solely to make migration easier.
- Claiming WCAG conformance, complete screen-reader support, real-device coverage, contrast certification, search-ranking quality, or successful deployment as a substitute for the defined acceptance evidence.
- Using a live package registry as a required build-time authority for version or compatibility content.
- Introducing a telemetry exception, override flag, soft-warning publication path, or post-failure secret-scan bypass.

## Further Notes

- This specification synthesizes the closed decisions in tickets 0013 through 0023 and is the implementation input for the Public Documentation Site.
- The selected implementation seam was confirmed by the user before this specification was written.
- The specification does not itself authorize a production deploy, domain purchase, package publish, or other external effect.
- Before implementation begins, the selected Docusaurus dependency line and current repository release metadata must be revalidated because those facts are time-sensitive.
