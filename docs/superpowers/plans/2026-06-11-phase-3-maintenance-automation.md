# Phase 3: Maintenance Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** Phase 2 (Governance Surfaces) — G1–G4 commands stable

**Goal:** Add 7 maintenance automation commands (M1–M7) that detect stale docs, drift, and repeated findings, producing reviewable gardening proposals without auto-fixing. Implements ROADMAP V5.5 "Continuous Amber Maintenance".

---

## M1: `amber maintenance stale-docs` — detect Last Reviewed age

**Purpose:** Report Wiki/governance docs exceeding configurable age threshold (default 90 days), using `<!-- Last Reviewed: YYYY-MM-DD -->` markers.

### Steps

- [ ] M1.1: Create `scripts/lib/core/maintenance.js` with `detectStaleDocs(projectRoot, thresholdDays)`
  - Scan `docs/wiki/` and `.amber/governance/` for `.md` files
  - Parse `<!-- Last Reviewed: YYYY-MM-DD -->` from first 10 lines
  - Compare to current date; flag docs older than threshold or missing marker
  - Return: `{ stale: [{path, lastReviewed, age}], missing: [path] }`
- [ ] M1.2: Add `validateLastReviewedFormat(line)` — RFC3339 date check
- [ ] M1.3: Wire `amber maintenance stale-docs --target <repo> [--threshold <days>] [--json]`
- [ ] M1.4: Test: doc with `<!-- Last Reviewed: 2025-01-01 -->` + threshold 90 → flagged; doc missing marker → listed; fresh doc → clean
- [ ] M1.5: Output format: table (path | last reviewed | age days | action) + summary count

---

## M2: `amber maintenance wiki-lint` — validation command + CI suggestion

**Purpose:** Validate Wiki internal links, required sections, Last Reviewed markers; suggest CI integration command.

### Steps

- [ ] M2.1: Add `validateWikiStructure(projectRoot)` in `scripts/lib/core/maintenance.js`
  - Check `docs/wiki/index.md` exists + links to product/architecture/engineering/agent
  - Validate internal `[text](../path.md)` links resolve to real files
  - Check required sections per SPEC: overview, system-map, module-boundaries, runbook, verification, amber, failure-patterns
  - Flag missing Last Reviewed markers (reuse M1 logic)
- [ ] M2.2: Wire `amber maintenance wiki-lint --target <repo> [--json]`
- [ ] M2.3: Output: broken links list + missing sections + stale docs + "To enable in CI: `amber maintenance wiki-lint --target . --json > /tmp/lint.json && test $(jq '.errors | length' /tmp/lint.json) -eq 0`"
- [ ] M2.4: Test: Wiki with broken link → error; missing section → warning; all valid → exit 0
- [ ] M2.5: Add `--fix-markers` flag: append `<!-- Last Reviewed: <today> -->` to docs missing marker (idempotent, only touches missing)

---

## M3: `amber maintenance pack-drift` — compare lock vs registry

**Purpose:** Detect installed rule-pack/workflow-pack versions differing from registry (simulates lock file drift check).

### Steps

- [ ] M3.1: Add `detectPackDrift(projectRoot)` in `scripts/lib/core/maintenance.js`
  - Load `.amber/installed-packs.json` (lock file shape: `{packs: [{name, version, installedAt}]}`)
  - Load local registry from `profiles/`, `standards/`, `workflow-packs/` (current available versions)
  - Compare: installed version vs available version
  - Return: `{ drifted: [{name, installedVersion, availableVersion, behind}], current: [name] }`
- [ ] M3.2: Wire `amber maintenance pack-drift --target <repo> [--json]`
- [ ] M3.3: Test: installed pack v1.0, registry v1.2 → drift warning; installed v1.2, registry v1.2 → current
- [ ] M3.4: Output: table (pack | installed | available | status) + "Run `amber maintenance upgrade-preview` to see changes"

---

## M4: `amber maintenance upgrade-preview` — version check + preview

**Purpose:** Show what would change if packs/profiles were upgraded; suggest upgrade command (doesn't execute).

### Steps

- [ ] M4.1: Add `previewPackageUpgrade(projectRoot, packName)` in `scripts/lib/core/maintenance.js`
  - Load current pack files from `.amber/` or target repo override
  - Load new pack files from registry
  - Diff: standards changes, profile changes, workflow changes, new skills
  - Return: `{ filesAdded: [], filesModified: [{path, oldHash, newHash}], filesRemoved: [] }`
- [ ] M4.2: Wire `amber maintenance upgrade-preview --target <repo> [--pack <name>]` (all packs if --pack omitted)
- [ ] M4.3: Test: pack with 1 new standard, 1 modified profile → preview shows both; no changes → "all current"
- [ ] M4.4: Output: per-pack diff summary + "To upgrade: `amber pack upgrade <name> --version <v>`" (command from future V5)

---

## M5: `amber maintenance evolution-rollup` — repeated findings summary

**Purpose:** Parse `.amber/harness-evolution.md` for repeated lessons; suggest Wiki/standards updates.

### Steps

- [ ] M5.1: Add `rollupEvolutionFindings(projectRoot)` in `scripts/lib/core/maintenance.js`
  - Parse `.amber/harness-evolution.md` entries (format: `## YYYY-MM-DD - <title>`)
  - Extract lessons mentioning "repeatedly", "always", "never", "every time" patterns
  - Group by topic: testing, git-workflow, standards, Wiki updates, workflow-pack candidates
  - Return: `{ repeated: [{topic, count, entries: [title]}], candidates: [{type: 'wiki'|'standard'|'workflow', rationale}] }`
- [ ] M5.2: Wire `amber maintenance evolution-rollup --target <repo> [--json]`
- [ ] M5.3: Test: evolution log with 3 "always run test before commit" entries → grouped as testing topic count=3
- [ ] M5.4: Output: grouped findings table + "Consider promoting to: [Wiki update / Standard rule / Workflow pack]"

---

## M6: `amber maintenance regression-proposals` — extract from evidence.json

**Purpose:** Find failed commands/assertions in `.amber/executions/*/evidence.json`; propose regression test cases.

### Steps

- [ ] M6.1: Add `extractRegressionProposals(projectRoot)` in `scripts/lib/core/maintenance.js`
  - Scan `.amber/executions/*/evidence.json` for `status: 'failed'` or `errors: [...]`
  - Extract: command, exit code, stderr snippet, failing assertion
  - Generate plain-English assertion: "Command `<cmd>` should exit 0 given input `<input>`"
  - Return: `{ proposals: [{taskId, command, assertion, replayInput}] }`
- [ ] M6.2: Wire `amber maintenance regression-proposals --target <repo> [--json]`
- [ ] M6.3: Test: execution with `npm test` exit 1 → proposal "npm test should exit 0 after fixing <feature>"
- [ ] M6.4: Output: proposals table (taskId | command | assertion | replay path) + "Review and add to test suite manually"

---

## M7: `amber maintenance proposal` — combined gardening report

**Purpose:** One-command maintenance report combining M1–M6 findings into reviewable action list.

### Steps

- [ ] M7.1: Add `generateMaintenanceProposal(projectRoot, outputPath)` in `scripts/lib/core/maintenance.js`
  - Run M1 stale-docs detection
  - Run M2 wiki-lint validation
  - Run M3 pack-drift check
  - Run M5 evolution-rollup
  - Run M6 regression-proposals
  - Aggregate into sections: Docs, Packs, Evolution, Regressions
  - Output Markdown with prioritized action list (Critical/High/Medium/Low)
- [ ] M7.2: Wire `amber maintenance proposal --target <repo> --output <file>`
- [ ] M7.3: Test: project with stale doc + pack drift + 2 evolution findings + 1 regression → proposal.md has 4 sections + priority tags
- [ ] M7.4: Add `--priority <level>` filter: only show >= priority level
- [ ] M7.5: Output includes "Estimated effort: <total tasks> × <avg time>" heuristic

---

## Verification Checklist (Phase 3 完成后)

- [ ] `npm test` — all existing + M1–M7 tests green
- [ ] `amber maintenance stale-docs --target .` → detects docs >90 days
- [ ] `amber maintenance wiki-lint --target .` → validates Wiki structure + exit 0 if valid
- [ ] `amber maintenance pack-drift --target .` → compares lock vs registry
- [ ] `amber maintenance upgrade-preview --target .` → shows diff without upgrading
- [ ] `amber maintenance evolution-rollup --target .` → groups repeated findings
- [ ] `amber maintenance regression-proposals --target .` → extracts failed commands
- [ ] `amber maintenance proposal --target . --output /tmp/maint.md` → combined report
- [ ] `npm run manifests` — green

---

## Notes

- **Read-only inspection:** All M1–M7 commands read state and produce proposals; NO auto-fix except M2's opt-in `--fix-markers` for Last Reviewed.
- **Thresholds:** M1 threshold defaults to 90 days; make configurable via `.amber/maintenance-config.json` (future).
- **CI integration:** M2 outputs CI-ready command; teams can add `amber maintenance wiki-lint` to PR checks.
- **Retention:** M7 proposal includes age-based cleanup suggestions (links to G4 audit retention policy).
- **Loop contracts:** These commands are candidates for future read-only loop automation (ROADMAP Future Track), but Phase 3 is CLI-only.
- **Evidence privacy:** Regression proposals (M6) may contain sensitive command args; future `--redact` flag needed.
