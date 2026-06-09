# Final Report

## Accepted

- Implement local manifest validation as a standalone script.
- Keep manifest validation outside the V1 product command surface.
- Aggregate manifest validation into `doctor` only when plugin manifest directories are present in the target.
- Document the validation as local structural validation, not platform publishing or certification.

## Rejected

- No plugin publishing, installation, external marketplace mutation, or platform certification.
- No Dynamic Workflow execution, product subagent orchestration, worktree orchestration, model routing, or automatic rewrite of old project files.

## Decisions

- `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json` are both required for validating this plugin repository.
- Local validation checks JSON shape, required common metadata, semver-like version, author name, skills path existence, and Codex interface metadata.
- Skills paths may resolve relative to the plugin root or the manifest directory to support the current Codex and Claude adapter shapes.

## Final Changes

- Added `scripts/validate-manifests.js`.
- Added `validateManifests()` to `scripts/lib/harness-core.js`.
- Added optional manifest aggregation to `doctor`.
- Added manifest fixtures and tests in `tests/fixtures/` and `tests/validate-manifests.test.js`.
- Added `npm run manifests`.
- Updated `README.md` and `BACKLOG.md`.

## Verification

- `npm test`: 26 passed, 0 failed.
- `npm run manifests`: `Errors: 0`.
- External Codex plugin validation: passed.
- CLI smoke: valid manifests returned 0 errors; bad manifest fixture returned non-zero with errors.
- Root safety check: no target Harness template instances were written to repository root.
- V1 boundary scan: only future ROADMAP V4/V4.5 references mention worktrees/subagents.

## Remaining Risks

- The exact Claude Code plugin schema remains an open assumption, so validation is intentionally structural and conservative.
- Audit still needs explicit `unknowns` and `nextSafeCommand` fields to fully match the safety contract.
- CLI help still shows global `--dry-run` even though only `init` and `wiki` use it meaningfully.
