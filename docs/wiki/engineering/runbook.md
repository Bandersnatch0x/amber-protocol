---
type: runbook
title: Runbook
description: How to run, operate, and recover the system.
tags: [engineering]
updated: 2026-08-28
Last Reviewed: 2026-09-29
---

# Runbook

## Startup

1. `npm install` (root; `apps/web` and `apps/docs` have their own installs).
2. Run the commands in [verification](verification.md) — `npm test` is the one that matters.
3. Read `PROGRESS.md` before changing code.

## Optional Knowledge Semantic Analysis

The deterministic `/knowledge` map never needs an LLM. When a provider is configured, the page
shows a disclosure and waits for the operator to click **Send repository titles and excerpts for
semantic analysis** before making any semantic request.

Server-only configuration:

| Variable         | Supported values / default                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LLM_API_KEY`    | No default. When absent, semantic analysis is unavailable.                                                                                                                                       |
| `LLM_PROVIDER`   | `openai` (default), `anthropic`, or `stub`. Any other value fails closed.                                                                                                                        |
| `LLM_MODEL`      | `gpt-4o-mini` by default. Set an explicit model supported by the provider.                                                                                                                       |
| `LLM_BASE_URL`   | Provider API by default. Custom URLs must use HTTPS; loopback HTTP is allowed for local/test providers. URLs with embedded credentials, query strings, fragments, or other schemes are rejected. |
| `LLM_TIMEOUT_MS` | `30000` by default and never greater than 30000 ms.                                                                                                                                              |

A semantic request sends bounded node identifiers, kinds, titles, body excerpts, and existing edge
triples to the configured provider. Treat a custom `LLM_BASE_URL` as a trusted credential and
repository-data recipient; the server sends `LLM_API_KEY` to that endpoint. The provider response
is bounded to 128 KiB and validated all-or-nothing before use.

Inferred edges and summaries exist only in the server's process-local LRU cache and the current
browser query result. They are never written to the repository, Amber stores, projections, or hash
chains, and the cache is cleared on server restart. Missing or invalid configuration, timeout,
provider HTTP failure, oversized/invalid output, or invalid graph references produce a bounded
failure notice while the deterministic map stays usable; technical provider details and secrets
are not returned to the browser.

## Common Tasks

- **Full test suite**: `npm test` (the run-owned temp root and its cleanup contract live in
  `scripts/run-tests.js`).
- **Repository gates**: `npm run manifests`, `node scripts/amber.js doctor --target .`,
  `npm run format:check`, `node scripts/gen-docs-cli.js --check`,
  `node scripts/gen-agent-commands.js --check`.
- **Documentation site**: `npm run docs:build`, `npm run docs:verify`,
  `npm run docs:gen:check`, `npm run docs:test`.
- **Readiness and routing**: `node scripts/amber.js audit --target .`,
  `node scripts/amber.js next --objective "<goal>" --target .`,
  `node scripts/amber.js governance report --target .`.
- **Release**: `npm run version:sync`, `npm run changelog`, then the tag push described in
  `CONTRIBUTING.md`; `npm run release:verify` is the terminal gate afterwards.

## Unknowns / Needs Confirmation

- None at this revision: the startup steps, the gate list and the release flow are the
  repository's own commands, and the test suite or CI exercises each one above.
