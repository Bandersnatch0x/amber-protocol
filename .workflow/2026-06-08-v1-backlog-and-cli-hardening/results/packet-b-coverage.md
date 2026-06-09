# Packet B Result: CLI And Validator Coverage Review

## Findings

1. High: unified CLI failure paths are under-tested. Add tests for non-zero `wiki`, `handoff`, and `doctor` failure exits plus parseable `--json` on failures.
2. High: low-level validator wrappers are advertised but not spawned in tests. Add wrapper tests for `validate-feature-list.js`, `validate-wiki.js`, and `validate-handoff.js`.
3. Medium: feature-list schema branches need broader table coverage.
4. Medium: wiki validation needs coverage for missing wiki dir, empty wiki, missing index, external links, anchors, query stripping, and nested relatives.
5. Medium-low: doctor aggregation is mostly happy-path covered.

## Suggested Next Test-First Slice

Add CLI failure and wrapper spawn tests against broken fixtures before expanding command surface.

## Continuation Update

- Implemented the suggested CLI failure and wrapper spawn coverage.
- Expanded feature-list, wiki, and doctor validator coverage.
- Added a regression path for broken Harness doctor aggregation, including `PROGRESS.md` next-action validation.
- Added starter Wiki unknown-marker validation and template coverage.
- Verification on 2026-06-08: `npm test` passed 36 tests.
