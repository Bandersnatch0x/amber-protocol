# Amber Protocol Web Viewer Design Review

Date: 2026-07-07
Scope: All generated and implemented web screens listed in `.stitch/metadata.json`.

## Review Basis

- Design system: `.stitch/DESIGN.md`
- Screen prompts: `.stitch/screen-prompts.md`
- Stitch metadata: `.stitch/metadata.json`
- Implementation: `apps/web/src/routes`, `apps/web/src/components`, `apps/web/src/features`
- Visual/runtime evidence: `output/playwright/fidelity/automated-inspection.json`
- Screenshot evidence: `output/playwright/fidelity/*.png` and latest `output/playwright/i18n-*` / `output/playwright/code-display-*` captures
- Verification commands: `npm test`, `npm run build`, and local Chrome Playwright smoke checks

## Review Standard

This review applies a grill-me style red-team pass rather than a soft visual sign-off. Each screen is checked for:

- Alignment with the quiet, dense, developer-native design system.
- Prompt fidelity for information architecture and state handling.
- Use of real repository data rather than decorative placeholder data.
- Responsive behavior on desktop and mobile.
- Internationalization coverage for static UI while preserving raw dynamic data.
- Long-text, JSON, code, diff, and transcript safety.
- Basic accessibility expectations: semantic controls, focusable actions, readable labels, and non-color-only state.
- Runtime evidence: no 404, no runtime overlay, no console/page errors, no failed requests, and no horizontal page overflow.

## Page Results

| Screen | Route | Status | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Home / Repository Control Surface | `/` | PASS | `home.png`, `mobile-home.png`, automated inspection `home` and `mobile-home` | Matches compact operator-console intent, avoids marketing hero treatment, exposes primary workflows and governance references. |
| Sessions List | `/sessions` | PASS | `sessions.png`, `mobile-sessions.png`, automated inspection `sessions` and `mobile-sessions` | Filter-first operational list with loading/empty/error handling and localized static labels. |
| Session Detail | `/sessions/$id` | PASS | `session-detail.png`, `mobile-session-detail.png`, `session-manifest-code-view.png`, automated inspection `session-detail` and `mobile-session-detail` | Keeps status, controls, activity, metadata, and collapsed manifest inspection in the expected priority order. |
| Session Timeline | `/sessions/$id/timeline` | PASS | `session-timeline.png`, `mobile-session-timeline.png`, `timeline-raw-code-view.png`, automated inspection `session-timeline` and `mobile-session-timeline` | Event filtering, raw event inspection, status semantics, and mobile stacking are represented without dashboard drift. |
| Routes List | `/routes` | PASS | `routes.png`, `mobile-routes.png`, automated inspection `routes` and `mobile-routes` | Route comparison is dense and workflow-oriented, not a marketing feature grid. |
| Route Detail | `/routes/$id` | PASS | `route-detail-feature-standard.png`, `mobile-route-detail-feature-standard.png`, automated inspection `route-detail-feature-standard` and `mobile-route-detail-feature-standard` | Stage structure and metadata remain readable and evidence-oriented. |
| Gates | `/gates` | PASS | `gates-fixed.png`, `mobile-gates.png`, `i18n-gates-en.png`, `i18n-gates-zh.png`, automated inspection `gates` and `mobile-gates` | Inbox treatment is restored; rows are reviewable, filtered, and localized without inline destructive decisions. |
| Transcripts List | `/transcripts` | PASS | `transcripts-directory-outline-final.png`, `mobile-transcripts.png`, automated inspection `transcripts` and `mobile-transcripts` | Directory and outline summaries are present, with searchable archival framing. |
| Transcript Detail | `/transcripts/$id` | PASS | `transcript-detail-dynamic.png`, `transcript-code-view-fixed.png`, `transcript-diff-view-fixed.png`, `transcript-metadata-final.png`, automated inspection `transcript-detail-dynamic` | Preserves raw transcript evidence while supporting hidden system records, metadata grouping, code/diff blocks, expand/collapse, horizontal scrolling, and no page-level overflow. |
| Settings | `/settings` | PASS | `settings.png`, `mobile-settings.png`, `i18n-settings-zh.png`, automated inspection `settings` and `mobile-settings` | Local tool preferences remain simple, stacked, and keyboard-friendly without profile/account UI drift. |

## Automated Evidence Summary

The current automated inspection covers the 10 desktop surfaces plus mobile checks for all main screens. The recorded results show:

- HTTP status `200` for each inspected route.
- `ok: true` for each inspected route.
- `pageOverflowing: false` for each inspected route.
- No console messages, failed requests, bad responses, not-found states, or runtime overlays.
- Mobile viewport width remains contained with no horizontal page overflow.
- Final local Chrome check saved fresh evidence under `output/playwright/final-check/`: `/gates`, `/settings`, `/transcripts`, one real `/transcripts/$id`, and mobile `/gates` all returned `200`, had no console/page errors, and had no page-level horizontal overflow.

## Independent Subagent Review Results

Three independent grill-me style subagent reviews were run after implementation:

- Home, Sessions List, Session Detail, and Session Timeline: PASS. Non-blocking notes covered CodeBlock static English labels, capped raw JSON scrolling, task progress color drift, and abort dialog accessibility hardening.
- Routes List, Route Detail, and Gates: PASS. Non-blocking notes covered filtered empty-state context, long route/stage strings, and future gate-specific deep links.
- Transcripts List, Transcript Detail, and Settings: PASS. Non-blocking notes covered CodeBlock i18n/accessibility, transcript metadata disclosure semantics, and settings save/error live feedback.

Resolved follow-ups from the independent reviews:

- `CodeBlock` static labels now use the shared i18n dictionary for line counts, copy state, expand/collapse, and hidden-line summaries.
- `CodeBlock` expand controls now expose `aria-expanded` and `aria-controls`; copy state is announced with `aria-live="polite"`.
- `CodeBlock` now caps code display height with internal scrolling, preserving long-line horizontal scroll without page-level overflow.
- Transcript metadata disclosure now exposes `aria-expanded` and `aria-controls`.
- Settings save/error feedback now sits inside a polite live region.
- Timeline `task_progress` color is back on the blue accent scale used by the design system.

## Code Display Review

Code and transcript display was reviewed separately because it had explicit product requirements:

- Diff labeling is present.
- Long code blocks support collapse and expand.
- Code blocks expose copy controls.
- Long lines are handled with local horizontal scrolling instead of page-level truncation or overflow.
- Syntax highlighting is protected by an automated test that asserts `highlight.js` token output for supported languages.

Evidence:

- `output/playwright/code-display-before-expand.png`
- `output/playwright/code-display-after-expand.png`
- `output/playwright/fidelity/transcript-code-view-fixed.png`
- `output/playwright/fidelity/transcript-diff-view-fixed.png`
- `apps/web/src/components/code/CodeBlock.test.tsx`
- `output/playwright/final-check/transcript-detail-code-facts.json`

## Internationalization Review

Static UI has English and Chinese coverage through `apps/web/src/lib/i18n.tsx` and the shared language toggle. Browser verification confirmed:

- English gates page renders expected English static UI from a clean `amber-web-language=en` state.
- Switching language updates static page body text to Chinese.
- Raw dynamic data, identifiers, prompts, route ids, session ids, timestamps, transcript content, manifest JSON, and code/diff content remain unmodified.

Evidence:

- `output/playwright/i18n-toggle-gates-en.png`
- `output/playwright/i18n-toggle-gates-zh.png`
- `output/playwright/fidelity/i18n-*.png`

## Remaining Risks

- Stitch MCP tools were not available in this session; the project was created and inspected through browser automation. `.stitch/metadata.json` records that limitation.
- Some Stitch-generated nodes were noted as desktop-only while implementation has mobile verification. The implementation screenshots and Playwright evidence are therefore the stronger source for responsive acceptance.
- Dynamic repository data can change over time, so future runs should refresh Playwright evidence if the fixture/data set changes materially.

## Verdict

PASS. All 10 scoped screens have design prompts, implementation coverage, screenshot/runtime evidence, and page-level review evidence. No blocking design defects remain in the current reviewed state.
