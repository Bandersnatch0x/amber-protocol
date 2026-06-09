# Packet B: CLI And Validator Coverage Review

## Objective

Review unified CLI and validator coverage for behavior gaps.

## Context

The unified V1 CLI lives at `scripts/harness.js` and maps `init`, `audit`, `wiki`, `doctor`, and `handoff`.

## Files / Sources

- `scripts/harness.js`
- `scripts/lib/harness-core.js`
- `scripts/*.js`
- `package.json`
- `README.md`
- `tests/*.js`
- `tests/fixtures/`

## Ownership

Read-only review. Do not edit files.

## Do

- Identify missing tests and behavior risks.
- Order findings by severity.
- Recommend one test-first implementation slice.

## Do Not

- Duplicate Packet A's broad product backlog.
- Propose expanding beyond V1.

## Expected Output

Concrete missing tests or behavior risks with file/function references.

## Verification

Recommendations should be implementable with local tests.
