# Amber Protocol Rename and Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** ✅ Phase 1 completed 2026-06-11 on branch `feat/amber-protocol-rename` (456/456 tests green, manifests green, audit guard green). Phase 2 (governance surfaces) remains a skeleton pending its own detailed plan.

**Execution notes (deviations discovered while implementing):**
- `scripts/amber.js` has a `require.main === module` entry guard, so the forwarding shims must call the exported `run()` explicitly — a bare `require()` is inert. The plan's original shim code was corrected accordingly.
- The repo had no `.amber/` gitignore entry; the first resolver commit accidentally captured 323 runtime session files and was redone via soft-reset with `.amber/` ignored.
- Per-module commits for the resolver wiring collapsed into one Phase B commit: switching test fixtures from `.harness` to `.amber` spans all session/daemon/worktree tests at once, so implementation and assertions had to move together.
- `orchestrationPaths`/`teamStatePaths` are shared by creators and readers; both gained a `forCreate` option instead of a blanket switch.
- **The project has never shipped (user decision mid-execution): there is no V5.5 audience to migrate.** `docs/release/MIGRATION_GUIDE.md` and the `migrating-from-v5.5` tutorial were deleted instead of rewritten. `amber migrate state|wiki` stay — they serve pre-rename working copies of this repo.
- Third-party repository references and placeholder external org links were removed on user request (SPEC reference implementation mention, `github.com/coding-harness` links, Discord placeholder).
- The audit guard gained line-level legacy-marker exemptions (`legacy|deprecated|formerly|…`) so README/UL can state the former name without file-level grants; `classifyTarget` product evidence now checks `scripts/amber.js`.
- Validation item "amber handoff --target . passes" was wrong in the draft: `session-handoff.md` never existed in the product repo (verified identical on master) — handoff is a target-repo command. Item recorded as N/A, not a regression.
- A parallel agent cleaned `stockagents` strings during Tasks 6–7; later commits switched from `git add -A` to explicit paths to avoid absorbing its work.

**Goal:** Rename Coding Harness to **Amber Protocol** (package `amber-protocol`, CLI `amber`, state dir `.amber`) with legacy compatibility, then add governance-facing evidence/policy/audit surfaces in a separate phase.

**Architecture:** Phase 1 is a compatibility-safe rename: new `amber` entrypoints with forwarding shims, the facade renamed to `amber-core.js` (the 21 `scripts/lib/core/` domain modules stay), a shared state-dir resolver (`.amber` canonical, `.harness` legacy-read), migration commands (`migrate state`, `migrate wiki`), asset renames with all code references updated, doc rewrite/archival, and a permanent legacy-reference audit test. Phase 2 (governance: evidence export, policy check, audit export) is sketched here and gets its own detailed plan after Phase 1 ships.

**Tech Stack:** Node.js CLI (CommonJS), Node built-in test runner, JSON schemas/manifests, repo-local `.amber` state.

---

## Reality Corrections vs. the Draft Spec

This plan supersedes the draft in five places, verified against the repo on 2026-06-11:

1. **`harness-core.js` is already a 289-line pure re-export facade** (split completed on branch `refactor/split-harness-core`, 24 commits, 439 tests green). Implementation lives in 21 modules under `scripts/lib/core/` whose names contain no "harness". Task 2 therefore renames a facade, not an implementation, and must update two guard tests: `tests/unit/harness-core-exports.test.js` (57-symbol snapshot) and `tests/harness-core-structure.test.js` (no-facade-require, 800-line ceiling, logic-free facade).
2. **`.harness` is hardcoded in ~12 modules, not 8** — including four V1–V5.5 core modules the draft missed: `core/task-execution.js` (worktrees/executions/orchestration), `core/team.js` (team root + lock paths), `core/maintenance.js` (executions root), `core/agent-orchestration.js` (ledger). Also missed: `autonomous-executor.js`, `checkpoint-manager.js`, `daemon.js` (3 sites), `metrics-collector.js`, and help text in the CLI entrypoint. The draft's `timeline-reader/writer`, `session-manifest`, `session-state-machine` receive paths via parameters and need **no** change.
3. **Asset renames break code references the draft didn't list:** `registry/coding-harness.registry.json` is wired into `core/constants.js` (`DEFAULT_TEAM_REGISTRY`); `harness-delivery` / `safe-harness-bootstrap` IDs appear in `core/doctor.js`, `core/maintenance.js`, the CLI help text, `team-presets/safe-bootstrap.team-preset.json`, and five `tests/phase-v*.test.js` files.
4. **Resolver write semantics are refined** (decision): a blanket "writes go to `.amber`" would split a live legacy session's state across two directories (manifest in `.harness`, new lock/timeline in `.amber`). Instead: **creating a new entity** (session, team install, execution) always targets `.amber`; **writes inside an existing entity** follow the directory that entity already lives in (callers already pass `sessionDir`/entity roots around, so this falls out naturally).
5. **Doctor compatibility decision: new-name-only + forced migration.** `MINIMUM_HARNESS_FILES` switches to `docs/wiki/agent/amber.md` with no alias. Old target repos fail `doctor` until they run `amber migrate wiki`. The doctor failure message must say exactly that.

**Branch prerequisite:** all work builds on the completed split. Task 0 merges `refactor/split-harness-core` into `master` first (fast-forward; master has no new commits since the fork).

---

## File Structure (Phase 1 end state)

```
scripts/
├── amber.js                    ← moved from scripts/harness.js (CLI, ~full content)
├── harness.js                  ← NEW 4-line forwarding shim (no warning)
├── compat/coding-harness.js    ← NEW shim, one stderr deprecation warning
├── scaffold-amber.js           ← renamed from scaffold-harness.js
├── lib/
│   ├── amber-core.js           ← moved from harness-core.js (pure facade)
│   ├── harness-core.js         ← NEW 3-line legacy alias re-exporting amber-core
│   ├── state-dir-resolver.js   ← NEW (.amber canonical / .harness legacy read)
│   ├── state-migration.js      ← NEW (migrate state + migrate wiki logic)
│   └── core/                   ← 21 modules, file names unchanged
registry/amber-protocol.registry.json      ← renamed
rule-packs/amber-delivery.rule-pack.json   ← renamed
standards/amber-delivery.json              ← renamed
workflow-packs/safe-amber-bootstrap.pack.json ← renamed
skills/amber-{init,audit,wiki,doctor,handoff,continuous-improvement}/ ← renamed (6)
templates/docs/wiki/agent/amber.md         ← renamed from harness.md
docs/legacy/{guide.md, harness-engineering-process-manual.md} ← archived
docs/release/MIGRATION_GUIDE.md            ← rewritten for the rename
tests/
├── unit/amber-core-exports.test.js        ← renamed + legacy-alias assertion
├── amber-core-structure.test.js           ← renamed + facade-name updates
├── unit/state-dir-resolver.test.js        ← NEW
├── unit/state-migration.test.js           ← NEW
└── legacy-references.test.js              ← NEW permanent grep-audit guard
```

Naming convention used throughout: product **Amber Protocol**, package `amber-protocol`, CLI `amber`, state dir `.amber`, env prefix `AMBER_`.

---

# Phase 1 — Rename with Compatibility

## Task 0: Merge the split branch and open the feature branch

**Files:** none (git only)

**Current repo state (verified 2026-06-11):** HEAD is on `refactor/split-harness-core` (24 commits ahead of `master`, all tests green); `master` has no commits since the fork, so a fast-forward merge applies cleanly. Work tree is clean.

- [ ] **Step 0.1:** Confirm clean tree, then merge the split into master:

```bash
git -C D:/code_space/coding-harness status --short   # expect: empty output
git checkout master
git merge --ff-only refactor/split-harness-core       # expect: "Fast-forward"
npm test                                              # expect: # fail 0 (439 tests)
```

If `--ff-only` refuses (master gained commits since this plan was written), STOP and ask the user how to reconcile — do not force or rebase on your own.

- [ ] **Step 0.2:** Create the feature branch off the updated master:

```bash
git checkout -b feat/amber-protocol-rename
```

## Task 1: Public package and CLI rename

**Files:**
- Modify: `package.json`
- Move: `scripts/harness.js` → `scripts/amber.js` (then recreate `scripts/harness.js` as shim)
- Create: `scripts/compat/coding-harness.js`
- Test: `tests/harness-cli.test.js` (one new subtest; full rename of this file happens in Task 5)

- [ ] **Step 1.1: Write the failing shim test.** Append to `tests/harness-cli.test.js` (the file's existing helpers are `ROOT`, `CLI`, and `runHarness(args, options)` — `CLI` points at `scripts/harness.js`):

```js
test("legacy entrypoints forward to the amber CLI", () => {
	for (const entry of ["scripts/harness.js", "scripts/compat/coding-harness.js"]) {
		const result = spawnSync(process.execPath, [path.join(ROOT, entry), "--help"], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, `${entry} --help should exit 0`);
		assert.match(result.stdout, /amber|harness/i);
	}
	const compat = spawnSync(
		process.execPath,
		[path.join(ROOT, "scripts", "compat", "coding-harness.js"), "--help"],
		{ encoding: "utf8" },
	);
	assert.match(compat.stderr, /deprecated/i, "compat shim warns on stderr");
});
```

- [ ] **Step 1.2:** Run `node --test tests/harness-cli.test.js` — expect the new subtest FAILS (`scripts/compat/coding-harness.js` missing).

- [ ] **Step 1.3: Move the CLI and create both shims.**

```bash
git mv scripts/harness.js scripts/amber.js
mkdir scripts/compat
```

Create `scripts/harness.js`:

```js
#!/usr/bin/env node
"use strict";
// Legacy entrypoint. The CLI moved to scripts/amber.js (Amber Protocol rename).
require("./amber");
```

Create `scripts/compat/coding-harness.js`:

```js
#!/usr/bin/env node
"use strict";
// Legacy bin alias for the renamed amber-protocol package.
if (!process.env.AMBER_SUPPRESS_DEPRECATION) {
	process.stderr.write(
		"[deprecated] `coding-harness` is now `amber` (Amber Protocol). " +
			"This alias will be removed in a future release.\n",
	);
}
require("../amber");
```

**Why stderr:** the CLI tests assert that stdout is parseable JSON on failure paths; a stdout warning would break them.

- [ ] **Step 1.4: Update `package.json`** (name, bins, scripts):

```json
{
	"name": "amber-protocol",
	"version": "1.0.0",
	"description": "Amber Protocol: repository-local governance kit for coding agents — install, audit, validate, and hand off agent-facing project state.",
	"private": true,
	"type": "commonjs",
	"bin": {
		"amber": "scripts/amber.js",
		"coding-harness": "scripts/compat/coding-harness.js"
	},
	"scripts": {
		"test": "node --test",
		"check": "node --test",
		"doctor": "node scripts/amber.js doctor --target .",
		"handoff": "node scripts/amber.js handoff --target .",
		"manifests": "node scripts/validate-manifests.js --target ."
	}
}
```

- [ ] **Step 1.5:** Regenerate the lockfile name field: `npm install --package-lock-only` (syncs `package-lock.json` to `amber-protocol`). Run `node --test tests/harness-cli.test.js` — expect ALL subtests PASS (existing tests spawn `scripts/harness.js`, which now forwards). Run `npm run doctor` — expect pass.

- [ ] **Step 1.6: Commit.**

```bash
git add -A && git commit -m "feat(amber): rename package to amber-protocol, add amber CLI with legacy shims"
```

## Task 2: Facade rename (`amber-core.js`)

**Files:**
- Move: `scripts/lib/harness-core.js` → `scripts/lib/amber-core.js`
- Create: `scripts/lib/harness-core.js` (3-line alias)
- Modify: `scripts/amber.js`, `scripts/audit-project.js`, `scripts/doctor.js`, `scripts/scaffold-harness.js`, `scripts/validate-feature-list.js`, `scripts/validate-handoff.js`, `scripts/validate-manifests.js`, `scripts/validate-wiki.js` (require path)
- Move: `scripts/scaffold-harness.js` → `scripts/scaffold-amber.js`
- Move: `tests/unit/harness-core-exports.test.js` → `tests/unit/amber-core-exports.test.js`
- Move: `tests/harness-core-structure.test.js` → `tests/amber-core-structure.test.js`
- Modify: the 6 direct-require test files (`tests/phase-v1-5.test.js`, `tests/scaffold-harness.test.js`, `tests/validate-feature-list.test.js`, `tests/validate-wiki.test.js`, `tests/validate-handoff.test.js`, `tests/validate-manifests.test.js`)

- [ ] **Step 2.1: Write the failing alias test.** In `tests/unit/harness-core-exports.test.js` (pre-rename), add:

```js
test("legacy harness-core alias re-exports amber-core identically", () => {
	const amber = require("../../scripts/lib/amber-core");
	const legacy = require("../../scripts/lib/harness-core");
	assert.strictEqual(legacy, amber, "alias must be the same object");
});
```

Run `node --test tests/unit/harness-core-exports.test.js` — expect FAIL (`amber-core` not found).

- [ ] **Step 2.2: Move the facade and create the alias.**

```bash
git mv scripts/lib/harness-core.js scripts/lib/amber-core.js
```

Edit the moved file's header comment to say "Amber Protocol facade". Create `scripts/lib/harness-core.js`:

```js
"use strict";
// Legacy alias: the facade moved to amber-core.js (Amber Protocol rename).
module.exports = require("./amber-core");
```

- [ ] **Step 2.3: Update the 8 script requires** from `require("./lib/harness-core")` to `require("./lib/amber-core")`, and `git mv scripts/scaffold-harness.js scripts/scaffold-amber.js` (update any `package.json`/docs references to it — grep first: `grep -rn "scaffold-harness" --include="*.js" --include="*.json" --include="*.md" . | grep -v node_modules`).

- [ ] **Step 2.4: Rename and update the guard tests.**

```bash
git mv tests/unit/harness-core-exports.test.js tests/unit/amber-core-exports.test.js
git mv tests/harness-core-structure.test.js tests/amber-core-structure.test.js
```

In `amber-core-exports.test.js`: point the snapshot at `amber-core`, keep the alias test from Step 2.1. In `amber-core-structure.test.js`: the facade path becomes `../scripts/lib/amber-core.js`; the "no facade require" assertion must now reject **both** names:

```js
assert.ok(
	!source.includes("harness-core") && !source.includes("amber-core"),
	`${file} must not require a facade (circular require)`,
);
```

- [ ] **Step 2.5:** Update the 6 direct-require test files to `require("../scripts/lib/amber-core")` (adjust relative depth per file). **Leave exactly one** legacy require in `amber-core-exports.test.js` (the alias test) — that is the compatibility coverage.

- [ ] **Step 2.6:** Run `npm test` — expect `# fail 0`. Commit:

```bash
git add -A && git commit -m "feat(amber): rename facade to amber-core with legacy harness-core alias"
```

## Task 3: Runtime state directory resolver

**Files:**
- Create: `scripts/lib/state-dir-resolver.js`
- Test: `tests/unit/state-dir-resolver.test.js`
- Modify (Phase B): `scripts/lib/session-commands.js`, `scripts/lib/session-lock.js`, `scripts/lib/autonomous-policy.js`, `scripts/lib/autonomous-executor.js`, `scripts/lib/checkpoint-manager.js`, `scripts/lib/daemon.js`, `scripts/lib/metrics-collector.js`, `scripts/lib/worktree-manager.js`, `scripts/lib/stage-executor.js` (1 site — verified by sweep)
- Modify (core): `scripts/lib/core/task-execution.js`, `scripts/lib/core/team.js`, `scripts/lib/core/maintenance.js`, `scripts/lib/core/agent-orchestration.js`
- Modify: `scripts/amber.js` (help-text examples `.harness/...` → `.amber/...`)
- NOT modified (paths arrive via parameters): `session-manifest.js`, `session-state-machine.js`, `timeline-reader.js`, `timeline-writer.js`

- [ ] **Step 3.1: Write the failing resolver tests** — `tests/unit/state-dir-resolver.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
	resolveStateDirForRead,
	resolveStateDirForCreate,
	CANONICAL_STATE_DIR,
	LEGACY_STATE_DIR,
} = require("../../scripts/lib/state-dir-resolver");

function tmpRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-resolver-"));
}

test("no state exists: both read and create resolve to .amber", () => {
	const root = tmpRoot();
	assert.equal(resolveStateDirForRead(root), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("only .amber exists: read and create resolve to .amber", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".amber"));
	assert.equal(resolveStateDirForRead(root), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("only .harness exists: read resolves legacy, create resolves .amber", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".harness"));
	assert.equal(resolveStateDirForRead(root), path.join(root, ".harness"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("both exist: .amber wins for read and create", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".amber"));
	fs.mkdirSync(path.join(root, ".harness"));
	assert.equal(resolveStateDirForRead(root), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("exports canonical and legacy dir names", () => {
	assert.equal(CANONICAL_STATE_DIR, ".amber");
	assert.equal(LEGACY_STATE_DIR, ".harness");
});
```

Run: `node --test tests/unit/state-dir-resolver.test.js` — expect FAIL (module missing).

- [ ] **Step 3.2: Implement** `scripts/lib/state-dir-resolver.js`:

```js
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const CANONICAL_STATE_DIR = ".amber";
const LEGACY_STATE_DIR = ".harness";

let warnedLegacyRead = false;
let warnedBothExist = false;

// Read resolution: prefer .amber; fall back to legacy .harness (warn once).
function resolveStateDirForRead(projectRoot, options = {}) {
	const amberDir = path.join(projectRoot, CANONICAL_STATE_DIR);
	const legacyDir = path.join(projectRoot, LEGACY_STATE_DIR);
	const amberExists = fs.existsSync(amberDir);
	const legacyExists = fs.existsSync(legacyDir);
	if (amberExists) {
		if (legacyExists && !warnedBothExist && !options.quiet) {
			process.stderr.write(
				"[amber] both .amber and .harness exist; using .amber and ignoring .harness " +
					"(run `amber migrate state` to consolidate)\n",
			);
			warnedBothExist = true;
		}
		return amberDir;
	}
	if (legacyExists) {
		if (!warnedLegacyRead && !options.quiet) {
			process.stderr.write(
				"[amber] reading legacy .harness state; new entities are created under .amber " +
					"(run `amber migrate state` to migrate)\n",
			);
			warnedLegacyRead = true;
		}
		return legacyDir;
	}
	return amberDir;
}

// Create resolution: new entities always live under .amber.
function resolveStateDirForCreate(projectRoot) {
	return path.join(projectRoot, CANONICAL_STATE_DIR);
}

// test hook: reset once-per-process warning latches
function resetWarnings() {
	warnedLegacyRead = false;
	warnedBothExist = false;
}

module.exports = {
	CANONICAL_STATE_DIR,
	LEGACY_STATE_DIR,
	resolveStateDirForRead,
	resolveStateDirForCreate,
	resetWarnings,
};
```

Run the resolver tests — expect PASS. Commit: `git add -A && git commit -m "feat(amber): add state-dir resolver (.amber canonical, .harness legacy read)"`.

- [ ] **Step 3.3: Replace hardcoded paths, one module per commit.** For each module below, replace `path.join(<root>, ".harness", ...)` with the resolver call, run `npm test`, and commit `refactor(amber): route <module> through state-dir resolver`. Rules:
  - **Discovery/listing of existing entities** (e.g. `getSessionsDir` in `session-commands.js`, `metrics-collector.js` sessions scan, `maintenance.js` executions scan, `loadTeamLock` read paths): use `resolveStateDirForRead(projectRoot)`.
  - **Creation of new entities** (`startSession`, `prepareTaskExecution` worktree/execution dirs, `dispatchAgentTask` ledger, `installTeamDistribution` team root, policy default write): use `resolveStateDirForCreate(projectRoot)`.
  - **Writes inside an existing entity** (lock files, checkpoints, timeline inside a session): derive from the entity dir the caller already holds — `session-lock.js:75` becomes `path.join(sessionDir, ".lock")`-style if the session dir is in scope, otherwise resolve-for-read.
  - Module order (each its own commit): `session-commands.js`, `session-lock.js`, `autonomous-policy.js`, `autonomous-executor.js`, `checkpoint-manager.js`, `daemon.js`, `metrics-collector.js`, `worktree-manager.js`, `stage-executor.js`, `core/task-execution.js`, `core/team.js`, `core/maintenance.js`, `core/agent-orchestration.js`.
  - Relative-path strings written into manifests (`.harness/worktrees/${id}` at `session-commands.js:116`, `core/task-execution.js:49-50`, `core/team.js:333-334`) become `.amber/...` for newly created entities — they describe the entity's own location.
  - After the last module: `grep -rn '"\.harness"' scripts/ --include="*.js"` must return only `state-dir-resolver.js` and the migration module.

- [ ] **Step 3.4: Regression tests.** Add to `tests/unit/state-dir-resolver.test.js`:

```js
test("startSession creates sessions under .amber, not .harness", async () => {
	const root = tmpRoot();
	const { startSession } = require("../../scripts/lib/session-commands");
	// goal is REQUIRED (session-commands.js:60 returns "Error: --goal is required");
	// route is optional but pinning it avoids route-selection variance.
	const start = await startSession(root, {
		goal: "demo goal",
		route: "feature-standard",
	});
	assert.strictEqual(start.exitCode, 0);
	assert.ok(fs.existsSync(path.join(root, ".amber", "sessions")));
	assert.ok(!fs.existsSync(path.join(root, ".harness")));
});

test("legacy .harness sessions remain readable", () => {
	const root = tmpRoot();
	const legacySession = path.join(root, ".harness", "sessions", "old-1");
	fs.mkdirSync(legacySession, { recursive: true });
	// Mirror the field shape createManifest() writes (see session-manifest.js)
	// so statusSession can render it; minimum: sessionId, state, route, goal.
	fs.writeFileSync(
		path.join(legacySession, "manifest.json"),
		JSON.stringify({
			sessionId: "old-1",
			state: "completed",
			goal: "legacy goal",
			route: { id: "feature-standard", version: "1.0.0" },
		}),
	);
	const { statusSession } = require("../../scripts/lib/session-commands");
	// statusSession reads options.sessionId and returns { text, exitCode } —
	// see tests/unit/session-commands.test.js:143-146 for the canonical usage.
	const result = statusSession(root, { sessionId: "old-1" });
	assert.strictEqual(result.exitCode, 0);
	assert.ok(result.text.includes("old-1"));
});
```

(Verified against the implementation: `async function startSession(projectRoot, options)` at `session-commands.js:57` requires `options.goal`; `statusSession(projectRoot, options)` at `session-commands.js:137` reads `options.sessionId` and returns a `{ text, exitCode }` result object — never assert on a `manifest` property. If the legacy fixture lacks a field statusSession renders, copy the full manifest shape from a real `createManifest()` output.)

Run `npm test` — expect `# fail 0`. Also update `scripts/amber.js` help-text `.harness/...` examples to `.amber/...` in this step. Commit.

## Task 4: State migration commands

**Files:**
- Create: `scripts/lib/state-migration.js`
- Modify: `scripts/amber.js` (register `migrate state` and `migrate wiki`)
- Modify: `scripts/lib/core/doctor.js` (failure hint)
- Test: `tests/unit/state-migration.test.js`

- [ ] **Step 4.1: Write failing tests** — `tests/unit/state-migration.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { migrateState, migrateWiki } = require("../../scripts/lib/state-migration");

function rootWithLegacyState() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-migrate-"));
	const sess = path.join(root, ".harness", "sessions", "s1");
	fs.mkdirSync(sess, { recursive: true });
	fs.writeFileSync(path.join(sess, "manifest.json"), JSON.stringify({ sessionId: "s1" }));
	fs.writeFileSync(path.join(sess, "timeline.jsonl"), JSON.stringify({ type: "start" }) + "\n");
	return root;
}

test("migrateState copies .harness into .amber and keeps the source", () => {
	const root = rootWithLegacyState();
	const result = migrateState(root);
	assert.ok(fs.existsSync(path.join(root, ".amber", "sessions", "s1", "manifest.json")));
	assert.ok(fs.existsSync(path.join(root, ".harness", "sessions", "s1", "manifest.json")), "source preserved");
	assert.equal(result.failed.length, 0);
	assert.ok(result.copied.length >= 2);
	assert.equal(result.validated.manifests, 1);
});

test("migrateState refuses to overwrite an existing .amber", () => {
	const root = rootWithLegacyState();
	fs.mkdirSync(path.join(root, ".amber"));
	const result = migrateState(root);
	assert.ok(result.errors.length >= 1);
	assert.match(result.errors[0], /\.amber already exists/);
});

test("migrateState reports corrupt manifests as failed validation, still copies", () => {
	const root = rootWithLegacyState();
	fs.writeFileSync(path.join(root, ".harness", "sessions", "s1", "manifest.json"), "{not json");
	const result = migrateState(root);
	assert.equal(result.failed.length, 1);
});

test("migrateWiki renames harness.md to amber.md and updates index links", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-wiki-"));
	const agentDir = path.join(root, "docs", "wiki", "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(path.join(agentDir, "harness.md"), "# Harness\n");
	fs.mkdirSync(path.join(root, "docs", "wiki"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "docs", "wiki", "index.md"),
		"[Agent](./agent/harness.md)\n",
	);
	const result = migrateWiki(root);
	assert.ok(fs.existsSync(path.join(agentDir, "amber.md")));
	assert.ok(!fs.existsSync(path.join(agentDir, "harness.md")));
	assert.match(fs.readFileSync(path.join(root, "docs", "wiki", "index.md"), "utf8"), /agent\/amber\.md/);
	assert.equal(result.renamed.length, 1);
});

test("migrateWiki is a no-op when amber.md already exists", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-wiki-"));
	const agentDir = path.join(root, "docs", "wiki", "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(path.join(agentDir, "amber.md"), "# Amber\n");
	const result = migrateWiki(root);
	assert.equal(result.renamed.length, 0);
	assert.equal(result.skipped.length, 1);
});
```

Run — expect FAIL (module missing).

- [ ] **Step 4.2: Implement** `scripts/lib/state-migration.js`:

```js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { CANONICAL_STATE_DIR, LEGACY_STATE_DIR } = require("./state-dir-resolver");

function walk(dir) {
	if (!fs.existsSync(dir)) return [];
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

// Copy-validate semantics: copy .harness -> .amber, never delete the source,
// refuse when .amber already exists, validate manifests/timelines post-copy.
function migrateState(projectRoot) {
	const source = path.join(projectRoot, LEGACY_STATE_DIR);
	const dest = path.join(projectRoot, CANONICAL_STATE_DIR);
	const result = {
		copied: [],
		skipped: [],
		failed: [],
		errors: [],
		validated: { manifests: 0, timelines: 0 },
	};
	if (!fs.existsSync(source)) {
		result.errors.push(`${LEGACY_STATE_DIR} not found at ${source}; nothing to migrate.`);
		return result;
	}
	if (fs.existsSync(dest)) {
		result.errors.push(
			`${CANONICAL_STATE_DIR} already exists at ${dest}; refusing to overwrite. ` +
				"Remove or merge it manually, then re-run.",
		);
		return result;
	}
	for (const file of walk(source)) {
		const rel = path.relative(source, file);
		const target = path.join(dest, rel);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(file, target);
		result.copied.push(rel);
	}
	// Post-copy validation
	for (const rel of result.copied) {
		const target = path.join(dest, rel);
		if (rel.endsWith("manifest.json")) {
			try {
				JSON.parse(fs.readFileSync(target, "utf8"));
				result.validated.manifests += 1;
			} catch {
				result.failed.push(`${rel}: manifest is not valid JSON`);
			}
		} else if (rel.endsWith("timeline.jsonl")) {
			const lines = fs.readFileSync(target, "utf8").split("\n").filter(Boolean);
			try {
				for (const line of lines) JSON.parse(line);
				result.validated.timelines += 1;
			} catch {
				result.failed.push(`${rel}: timeline contains a non-JSON line`);
			}
		}
	}
	return result;
}

// Rename docs/wiki/agent/harness.md -> amber.md in a TARGET repo and rewrite
// links in every wiki markdown file. Required because doctor accepts only the
// new name (decision: new-name-only + forced migration).
function migrateWiki(targetRoot) {
	const agentDir = path.join(targetRoot, "docs", "wiki", "agent");
	const oldPage = path.join(agentDir, "harness.md");
	const newPage = path.join(agentDir, "amber.md");
	const result = { renamed: [], linkUpdates: [], skipped: [], errors: [] };
	if (fs.existsSync(newPage)) {
		result.skipped.push("docs/wiki/agent/amber.md already exists");
		return result;
	}
	if (!fs.existsSync(oldPage)) {
		result.errors.push("docs/wiki/agent/harness.md not found; nothing to migrate.");
		return result;
	}
	fs.renameSync(oldPage, newPage);
	result.renamed.push("docs/wiki/agent/harness.md -> docs/wiki/agent/amber.md");
	const wikiRoot = path.join(targetRoot, "docs", "wiki");
	for (const file of walk(wikiRoot).filter((f) => f.endsWith(".md"))) {
		const content = fs.readFileSync(file, "utf8");
		const updated = content
			.replace(/agent\/harness\.md/g, "agent/amber.md")
			.replace(/\.\/harness\.md/g, "./amber.md");
		if (updated !== content) {
			fs.writeFileSync(file, updated);
			result.linkUpdates.push(path.relative(targetRoot, file));
		}
	}
	return result;
}

module.exports = { migrateState, migrateWiki };
```

Run the tests — expect PASS. Commit: `feat(amber): add migrate state / migrate wiki with copy-validate semantics`.

- [ ] **Step 4.3: Wire the CLI.** In `scripts/amber.js`, register `migrate state [--target <dir>]` and `migrate wiki [--target <dir>]` following the existing command-routing pattern (look at how `team install` parses subcommands). Output: JSON via the existing `printResult`, non-zero exit when `errors` or `failed` is non-empty. Add a CLI smoke subtest in `tests/harness-cli.test.js` (spawn `migrate state` on a temp dir with a fixture `.harness`, assert exit 0 and parseable JSON summary). In `core/doctor.js`, when `docs/wiki/agent/amber.md` is missing but `harness.md` exists, append the hint `"run: amber migrate wiki --target ."` to that finding (this lands with Task 5's constant flip; keep the hint logic behind the file-existence check so it is inert until then). Run `npm test`, commit.

## Task 5: Asset renames + code reference updates

**Files (renames):**
- `registry/coding-harness.registry.json` → `registry/amber-protocol.registry.json`
- `rule-packs/harness-delivery.rule-pack.json` → `rule-packs/amber-delivery.rule-pack.json`
- `standards/harness-delivery.json` → `standards/amber-delivery.json`
- `workflow-packs/safe-harness-bootstrap.pack.json` → `workflow-packs/safe-amber-bootstrap.pack.json`
- `skills/harness-{init,audit,wiki,doctor,handoff,continuous-improvement}/` → `skills/amber-*/` (6 dirs)
- `templates/docs/wiki/agent/harness.md` → `templates/docs/wiki/agent/amber.md`
- `tests/harness-cli.test.js` → `tests/amber-cli.test.js`; `tests/harness-cli-failures.test.js` → `tests/amber-cli-failures.test.js`; `tests/scaffold-harness.test.js` → `tests/scaffold-amber.test.js`

**Files (reference updates):**
- `scripts/lib/core/constants.js` (`DEFAULT_TEAM_REGISTRY`, `MINIMUM_HARNESS_FILES` wiki entry, `WIKI_CONTEXT_STARTER_FILES`)
- `scripts/lib/core/doctor.js`, `scripts/lib/core/maintenance.js` (pack/standard IDs)
- `scripts/amber.js` (help-text pack paths)
- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` (names, descriptions, skill paths)
- `team-presets/safe-bootstrap.team-preset.json`
- `tests/phase-v1-5.test.js`, `tests/phase-v2-5.test.js`, `tests/phase-v3.test.js`, `tests/phase-v5.test.js`, `tests/phase-future-loop-readiness.test.js`
- `templates/**` content links to `agent/harness.md` and "Harness" wording in starter pages
- inside renamed JSON assets: `name`/`id`/description fields (`harness-delivery` → `amber-delivery`, `safe-harness-bootstrap` → `safe-amber-bootstrap`)

Sequence (each bullet = run `npm test` + commit):

- [ ] **Step 5.1:** Registry: `git mv`, update JSON `name` field, update `DEFAULT_TEAM_REGISTRY` in `core/constants.js`, fix `tests/phase-v5.test.js` references. Tests green → commit.
- [ ] **Step 5.2:** Rule pack + standard: `git mv` both, update internal IDs, update `core/doctor.js` + `core/maintenance.js` + affected phase tests. Tests green → commit.
- [ ] **Step 5.3:** Workflow pack: `git mv`, update internal ID, update CLI help text + `tests/phase-v3.test.js` + `tests/phase-future-loop-readiness.test.js` + `team-presets/safe-bootstrap.team-preset.json`. Tests green → commit.
- [ ] **Step 5.4:** Skills: `git mv` all 6 dirs, update SKILL.md headings/wording, update both plugin manifests (skill paths + plugin name `amber-protocol` + descriptions). Run `npm run manifests` — must pass. Tests green → commit.
- [ ] **Step 5.5:** Template wiki page: `git mv templates/docs/wiki/agent/harness.md templates/docs/wiki/agent/amber.md`, rewrite its content for Amber wording, update every `templates/**` link to it (`grep -rn "agent/harness" templates/`), and sweep "Harness" product wording across all template content (`templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/PROGRESS.md`, `templates/session-handoff.md`, wiki starter pages — these are scaffolded into target repos, so new installs must read Amber). Flip `core/constants.js` `MINIMUM_HARNESS_FILES` + `WIKI_CONTEXT_STARTER_FILES` entries to `docs/wiki/agent/amber.md`, activate the doctor hint from Step 4.3. Update `tests/validate-wiki.test.js` / scaffold tests that assert the old path. Tests green → commit.
- [ ] **Step 5.6:** Rename the three CLI/scaffold test files (`git mv`), update their internal spawn targets to `scripts/amber.js` (the shim test from Task 1 keeps spawning the legacy paths on purpose). Tests green → commit.
- [ ] **Step 5.7:** Stragglers verified by sweep: `src/security/audit-report.js:110` (report footer `coding-harness security audit` → `amber-protocol security audit`) and `apps/web/package.json:2` (`@coding-harness/web` → `@amber-protocol/web`). Tests green → commit.
- [ ] **Step 5.8:** Constant rename pass inside `core/constants.js`: `MINIMUM_HARNESS_FILES` → `MINIMUM_AMBER_FILES` etc. would ripple through the snapshot test and all consumers — **do it only if** the export-snapshot test is updated in the same commit and `grep -rn "MINIMUM_HARNESS_FILES"` shows every consumer updated; otherwise defer constant identifier renames to a follow-up (they are internal names, not user-facing). Decide by grep count; either way tests green → commit.

## Task 6: Documentation rewrite and archival

**Files:**
- Modify: `README.md`, `README.zh-CN.md`, `SPEC.md`, `ROADMAP.md`, `UBIQUITOUS_LANGUAGE.md`, `BACKLOG.md`
- Move: `guide.md` → `docs/legacy/guide.md`; `harness-engineering-process-manual.md` → `docs/legacy/harness-engineering-process-manual.md`
- Modify: `docs/api/cli-commands.md`, `docs/user-guide/**`, `docs/examples/README.md`
- Modify: `docs/release/MIGRATION_GUIDE.md` (the rename migration story: bin aliases, `.amber`, `migrate state`, `migrate wiki`)

- [ ] **Step 6.1:** README pair: rename product to Amber Protocol, position as "repository-local governance layer for coding agents" (per the draft's positioning requirement), update every command example to `node scripts/amber.js` / `amber`, update the architecture diagram labels (`scripts/amber.js`, `scripts/lib/amber-core.js`, `scripts/lib/core/`, `.amber`). Commit.
- [ ] **Step 6.2:** SPEC.md / ROADMAP.md / UBIQUITOUS_LANGUAGE.md / BACKLOG.md: term replacement (Coding Harness → Amber Protocol, Harness → Amber where it names the product; "the harness files" generic prose becomes "the Amber files"). UBIQUITOUS_LANGUAGE.md gets new entries: **Amber Protocol**, **Amber State (`.amber`)**, **Legacy Harness State (`.harness`)**. Commit.
- [ ] **Step 6.3:** Archive the two manuals into `docs/legacy/` with a header note: `> Historical document predating the Amber Protocol rename; product names reflect the era.` Add `docs/legacy/README.md` explaining the convention. Commit.
- [ ] **Step 6.4:** `docs/api/cli-commands.md` + `docs/user-guide/**` + `docs/wiki/**` (product wiki: `PHASE_B_ALPHA_TASKS.md`, `SCHEMA_SPEC.md`) + `docs/architecture/**` + `docs/examples/README.md`: command/path updates (the generated artifacts under `docs/examples/` other than README stay untouched — historical evidence); MIGRATION_GUIDE.md rewritten around the rename (old bin → new bin, state migration, wiki migration, what stays compatible). Run `npm test` (wiki link validation runs inside it). Commit.

## Task 7: Legacy reference audit (permanent guard)

**Files:**
- Create: `tests/legacy-references.test.js`

- [ ] **Step 7.1: Write the audit test (it will fail listing current leftovers):**

```js
"use strict";
// Permanent guard: legacy "harness" naming may appear only in the allowlist.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const PATTERNS = [
	/coding-harness/i,
	/Coding Harness/,
	/harness-core/,
	/harness-delivery/,
	/safe-harness-bootstrap/,
	/scripts\/harness\.js/,
	/"\.harness"/,
];
const ALLOWLIST = [
	"scripts/harness.js",
	"scripts/compat/coding-harness.js",
	"scripts/lib/harness-core.js",
	"scripts/lib/state-dir-resolver.js",
	"scripts/lib/state-migration.js",
	"docs/legacy/",
	"docs/release/MIGRATION_GUIDE.md",
	"docs/release/CHANGELOG.md",
	"docs/release/RELEASE_NOTES.md",
	"docs/superpowers/plans/",
	"docs/superpowers/specs/",
	"docs/examples/", // historical review artifacts generated from real read-only trials — never rewritten
	".workflow/",
	"tests/fixtures/",
	"tests/legacy-references.test.js",
	"tests/unit/amber-core-exports.test.js",
	"tests/unit/state-dir-resolver.test.js",
	"tests/unit/state-migration.test.js",
	"tests/amber-cli.test.js", // shim-forwarding subtest spawns legacy entrypoints
	"package.json", // legacy bin alias
	"correctness-review.md",
	"correctness-review-round2.md",
	"maintainability-review.md",
	"maintainability-review-round2.md",
	"tests-review-round2.md",
	"fix-round1.md",
	"progress.md",
];
// Files inside allowlisted directories that must STILL be clean — Task 6
// rewrites these as active docs, so the directory grant must not cover them.
const MUST_BE_CLEAN = ["docs/examples/README.md"];
// Code shims allowed to carry old names must self-identify as legacy so the
// allowlist cannot silently become a hiding place for active code.
const SELF_IDENTIFYING_SHIMS = [
	"scripts/harness.js",
	"scripts/compat/coding-harness.js",
	"scripts/lib/harness-core.js",
];
const SCAN_DIRS = ["scripts", "tests", "docs", "templates", "skills", "registry",
	"rule-packs", "standards", "workflow-packs", "team-presets", "profiles",
	"routes", "schemas", "src", "apps", ".claude-plugin", ".codex-plugin"];
const ROOT_FILES = ["README.md", "README.zh-CN.md", "SPEC.md", "ROADMAP.md",
	"BACKLOG.md", "UBIQUITOUS_LANGUAGE.md", "package.json"];

function isAllowed(rel) {
	const slash = rel.split(path.sep).join("/");
	if (MUST_BE_CLEAN.includes(slash)) return false;
	return ALLOWLIST.some((a) => slash === a || slash.startsWith(a));
}

function* walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else yield full;
	}
}

test("legacy harness references appear only in the allowlist", () => {
	const offenders = [];
	const files = [
		...ROOT_FILES.map((f) => path.join(REPO, f)).filter(fs.existsSync),
	];
	for (const dir of SCAN_DIRS) {
		const abs = path.join(REPO, dir);
		if (fs.existsSync(abs)) files.push(...walk(abs));
	}
	for (const file of files) {
		const rel = path.relative(REPO, file);
		if (isAllowed(rel)) continue;
		if (!/\.(js|json|md)$/.test(file)) continue;
		const content = fs.readFileSync(file, "utf8");
		for (const pattern of PATTERNS) {
			if (pattern.test(content)) {
				offenders.push(`${rel}: ${pattern}`);
				break;
			}
		}
	}
	assert.deepEqual(offenders, [], `legacy references outside allowlist:\n${offenders.join("\n")}`);
});

test("code shims in the allowlist self-identify as legacy", () => {
	for (const shim of SELF_IDENTIFYING_SHIMS) {
		const content = fs.readFileSync(path.join(REPO, shim), "utf8");
		assert.match(
			content,
			/legacy|deprecated/i,
			`${shim} must carry a legacy/deprecated note — the allowlist must not hide active code`,
		);
	}
});
```

- [ ] **Step 7.2:** Run it; fix every offender it reports (these are the stragglers Tasks 1–6 missed). Re-run until green. Note: `.harness` as a *string in resolver/migration/docs about migration* is allowlisted by design; the pattern `"\.harness"` (quoted form) catches hardcoded path construction only.
- [ ] **Step 7.3:** `npm test` + `npm run manifests` green → commit `test(amber): add permanent legacy-reference audit guard`.

## Phase 1 Validation Checklist

- [ ] `npm test` passes (expected count: 439 baseline + ~12 new = ~451; zero fail).
- [ ] `npm run manifests` passes.
- [ ] `node scripts/amber.js doctor --target .` passes.
- [ ] `node scripts/amber.js handoff --target .` passes.
- [ ] `node scripts/harness.js doctor --target .` forwards and passes (no deprecation noise).
- [ ] `node scripts/compat/coding-harness.js doctor --target .` forwards, passes, warns once on stderr.
- [ ] Fresh `startSession` on a temp repo creates `.amber/sessions/`, never `.harness/`.
- [ ] A fixture `.harness` session is readable via `session status`.
- [ ] `amber migrate state` copies without deleting `.harness`; refuses when `.amber` exists.
- [ ] `amber migrate wiki` renames the agent wiki page and rewrites links; doctor passes afterward on a migrated legacy target.
- [ ] `tests/legacy-references.test.js` green — old names only in the allowlist.
- [ ] README positions Amber Protocol as a repo-local governance layer for coding agents.

---

# Phase 2 — Governance Surfaces (skeleton; detailed plan written after Phase 1 ships)

Phase 2 builds on the Amber domain model with **no rename leftovers mixed in**. Each task below gets full TDD expansion in `docs/superpowers/plans/<date>-amber-governance-surfaces.md` once Phase 1's validation checklist is green.

**Task G1: Governance domain documentation** — `docs/governance/domain-model.md` (Amber Session, Route, Gate, Policy, Evidence, Audit), `docs/governance/evidence-flow.md`; positions Amber as governing coding-agent behavior, not replacing agent frameworks; README links. No runtime behavior.

**Task G2: Evidence export** — `scripts/lib/evidence-exporter.js`, command `amber evidence export --session <id>`; reads manifest+timeline via the state-dir resolver (legacy `.harness` sessions readable); stable JSON output: session id, route id, event count, gate decisions, verification events, source file paths. Tests: normal / missing session / corrupt timeline / legacy-dir session.

**Task G3: Policy check** — wrap `autonomous-policy.js` behind `scripts/lib/amber-policy.js`, command `amber policy check` returning `allow | deny | require_approval` + human-readable reason. **Behavior note carried from review round 2 (W1):** the default policy auto-approves `user-approval` gates; G3 flips that default to `require_approval` and documents it — this is the standing safety concern, addressed here rather than in the rename phase. Tests: default user-approval → `require_approval`, explicit allow, explicit deny.

**Task G4: Audit export** — `scripts/lib/audit-exporter.js`, command `amber audit export`; PR-ready Markdown built on G2's evidence output: policy decisions, approvals, changed files when available, verification evidence, risk summary, rollback notes. Tests: complete session / missing verification / legacy-readable session.

Dependency order: G1 → G2 → (G3, G4 in parallel; G4 consumes G2).

---

## Assumptions (confirmed)

- Product name **Amber Protocol**; package `amber-protocol`; CLI `amber`; state dir `.amber`.
- Legacy `coding-harness` bin and `scripts/harness.js` shims kept ≥ one release; `scripts/lib/harness-core.js` alias kept indefinitely (3 lines, zero cost).
- Repo directory stays `D:\code_space\coding-harness`; directory name is not a legacy reference.
- Phase 1 adds no governance behavior; Phase 2 starts only after the Phase 1 checklist is green.
- Doctor accepts only `docs/wiki/agent/amber.md` (forced migration via `amber migrate wiki`) — user decision 2026-06-11.
- Large historical manuals (`guide.md`, `harness-engineering-process-manual.md`) are archived, not rewritten — user decision 2026-06-11.
- The flaky `tests/load/timeline-throughput.test.js` and other pre-existing issues from the 2026-06-11 assessment are out of scope here.
