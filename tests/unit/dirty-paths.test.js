"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const {
	classifyDirtyPaths,
	renderDirtyPathsSection,
} = require("../../scripts/lib/core/dirty-paths");

// ---- classifyDirtyPaths: pure, deterministic three-bucket routing ----

test("classifyDirtyPaths routes Amber bookkeeping to managed", () => {
	const result = classifyDirtyPaths(
		[
			".amber/sessions/abc.json",
			".harness/state.json",
			"config.json.amber-backup",
			".amber",
			".harness", // legacy state dir itself
		],
		{},
	);
	assert.deepEqual(result.managed, [
		".amber/sessions/abc.json",
		".harness/state.json",
		"config.json.amber-backup",
		".amber",
		".harness", // legacy state dir itself
	]);
	assert.deepEqual(result.focusWork, []);
	assert.deepEqual(result.outsideScope, []);
});

test("classifyDirtyPaths matches booked paths exactly and at segment boundaries", () => {
	const result = classifyDirtyPaths(["src/widget.js", "src/deep/helper.js", "lib/util.js"], {
		featurePaths: ["src/widget.js", "src/", "lib"],
	});
	assert.deepEqual(result.focusWork, ["src/widget.js", "src/deep/helper.js", "lib/util.js"]);
	assert.deepEqual(result.managed, []);
	assert.deepEqual(result.outsideScope, []);
});

test("classifyDirtyPaths does not treat a string prefix as a directory match", () => {
	// "src/" must not capture "srcx/a.js" — segment boundary, not substring.
	const result = classifyDirtyPaths(["srcx/a.js"], { featurePaths: ["src/"] });
	assert.deepEqual(result.focusWork, []);
	assert.deepEqual(result.outsideScope, ["srcx/a.js"]);
});

test("classifyDirtyPaths matches a git-abbreviated untracked dir containing a booked path", () => {
	// porcelain reports a fully-untracked directory as "src/", not per-file.
	const result = classifyDirtyPaths(["src/"], { featurePaths: ["src/widget.js"] });
	assert.deepEqual(result.focusWork, ["src/"]);
	assert.deepEqual(result.outsideScope, []);
	// But an untracked dir with no booked path inside stays outside scope.
	const parallel = classifyDirtyPaths(["other-dir/"], { featurePaths: ["src/widget.js"] });
	assert.deepEqual(parallel.outsideScope, ["other-dir/"]);
});

test("classifyDirtyPaths sends everything else outside scope, order preserved", () => {
	const result = classifyDirtyPaths(["zzz.txt", "aaa.txt", ".amber/x", "src/keep.js"], {
		featurePaths: ["src/"],
	});
	assert.deepEqual(result.outsideScope, ["zzz.txt", "aaa.txt"]);
	assert.deepEqual(result.managed, [".amber/x"]);
	assert.deepEqual(result.focusWork, ["src/keep.js"]);
});

test("classifyDirtyPaths prefers managed over focusWork for state-dir paths", () => {
	const result = classifyDirtyPaths([".amber/booked.js"], { featurePaths: [".amber/"] });
	assert.deepEqual(result.managed, [".amber/booked.js"]);
	assert.deepEqual(result.focusWork, []);
});

test("classifyDirtyPaths tolerates empty, null, and non-string input", () => {
	const empty = classifyDirtyPaths([], { featurePaths: ["src/"] });
	assert.deepEqual(empty, { managed: [], focusWork: [], outsideScope: [] });
	const nil = classifyDirtyPaths(null, { featurePaths: ["src/"] });
	assert.deepEqual(nil, { managed: [], focusWork: [], outsideScope: [] });
	const filtered = classifyDirtyPaths(["ok.js", 42, null, "", "   "], {});
	assert.deepEqual(filtered.outsideScope, ["ok.js"]);
	assert.deepEqual(filtered.managed, []);
	assert.deepEqual(filtered.focusWork, []);
});

test("classifyDirtyPaths normalizes backslashes and leading ./ to forward-slash paths", () => {
	const result = classifyDirtyPaths(["src\\win.js", "./notes.md"], { featurePaths: ["src/"] });
	assert.deepEqual(result.focusWork, ["src/win.js"]);
	assert.deepEqual(result.outsideScope, ["notes.md"]);
});

// ---- renderDirtyPathsSection: quiet when there is nothing to act on ----

test("renderDirtyPathsSection returns null for a clean tree", () => {
	assert.equal(renderDirtyPathsSection({ managed: [], focusWork: [], outsideScope: [] }), null);
	assert.equal(renderDirtyPathsSection(classifyDirtyPaths([])), null);
});

test("renderDirtyPathsSection returns null for managed-only churn", () => {
	const section = renderDirtyPathsSection(
		classifyDirtyPaths([".amber/a.json", ".harness/b.json", "f.amber-backup"]),
	);
	assert.equal(section, null);
});

test("renderDirtyPathsSection renders all three buckets when mixed", () => {
	const classification = classifyDirtyPaths(
		["src/widget.js", "notes-parallel.md", ".amber/session.json"],
		{ featurePaths: ["src/"] },
	);
	const section = renderDirtyPathsSection(classification);
	assert.ok(section.startsWith("## Dirty worktree"));
	assert.match(section, /^- src\/widget\.js$/m);
	assert.match(section, /this session's booked work is uncommitted — commit it before finishing/);
	assert.match(section, /handoff does not commit/);
	assert.match(section, /^- notes-parallel\.md$/m);
	assert.match(
		section,
		/not booked to the focus feature — parallel work or unbooked; left untouched/,
	);
	assert.match(section, /- plus 1 Amber-managed path\(s\) \(session state\) — ignored\./);
});

test("renderDirtyPathsSection omits the managed count and FYI lines when their buckets are empty", () => {
	const focusOnly = renderDirtyPathsSection(
		classifyDirtyPaths(["src/a.js"], { featurePaths: ["src/"] }),
	);
	assert.match(focusOnly, /^- src\/a\.js$/m);
	assert.match(focusOnly, /commit it before finishing/);
	assert.doesNotMatch(focusOnly, /Amber-managed/);
	assert.doesNotMatch(focusOnly, /left untouched/);

	const outsideOnly = renderDirtyPathsSection(classifyDirtyPaths(["other.md"]));
	assert.match(outsideOnly, /^- other\.md$/m);
	assert.match(outsideOnly, /left untouched/);
	assert.doesNotMatch(outsideOnly, /Amber-managed/);
	assert.doesNotMatch(outsideOnly, /commit it before finishing/);
});

// ---- end to end: renderHandoff on a real temp git repo with a dirty tree ----

test("renderHandoff surfaces the Dirty worktree classification read-only on a real git repo", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-dirty-paths-e2e-"));
	execSync("git init -q", { cwd: target });
	execSync("git config user.email a@b.c && git config user.name t", { cwd: target });

	const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
	scaffoldHarness(target);

	// Book paths onto the seeded F001 feature (the lifecycle focus).
	const featureListPath = path.join(target, "feature_list.json");
	const data = JSON.parse(fs.readFileSync(featureListPath, "utf8"));
	const f001 = data.features.find((f) => f.id === "F001");
	f001.paths = ["src/widget.js"];
	fs.writeFileSync(featureListPath, JSON.stringify(data, null, 2) + "\n");

	// Commit the scaffolded state so the tree starts clean.
	execSync("git add -A && git commit -qm init", { cwd: target });

	// Dirty one path per bucket: managed state churn, booked feature work,
	// and an unrelated parallel edit.
	fs.mkdirSync(path.join(target, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(target, ".amber", "session-state.json"), "{}");
	fs.mkdirSync(path.join(target, "src"), { recursive: true });
	fs.writeFileSync(path.join(target, "src", "widget.js"), "export {};\n");
	fs.writeFileSync(path.join(target, "notes-parallel.md"), "someone else's edit\n");

	const before = execSync("git status --porcelain", { cwd: target, encoding: "utf8" });

	const { renderHandoff } = require("../../scripts/lib/handoff-command");
	const text = renderHandoff(target);

	const after = execSync("git status --porcelain", { cwd: target, encoding: "utf8" });
	assert.equal(
		after,
		before,
		"handoff rendering must not mutate git state (byte-identical porcelain output)",
	);

	assert.match(text, /^## Dirty worktree$/m);
	// git abbreviates the brand-new src/ directory, so the bucket renders the
	// directory entry that contains the booked src/widget.js.
	assert.match(text, /^- src\/$/m);
	assert.match(text, /commit it before finishing; handoff does not commit\./);
	assert.match(text, /^- notes-parallel\.md$/m);
	assert.match(text, /parallel work or unbooked; left untouched\./);
	assert.match(text, /- plus 1 Amber-managed path\(s\) \(session state\) — ignored\./);

	// The regenerated handoff still satisfies the section validator (the new
	// section is deliberately conditional, not required) — validate the
	// RENDERED text, not the stale committed scaffold.
	const { validateHandoff } = require("../../scripts/lib/core/audit");
	const handoffPath = path.join(target, "session-handoff.md");
	const originalHandoff = fs.readFileSync(handoffPath, "utf8");
	fs.writeFileSync(handoffPath, text);
	assert.deepEqual(validateHandoff(target).errors, []);

	// Return the tree to its committed state: clean trees render no section.
	fs.writeFileSync(handoffPath, originalHandoff);
	fs.rmSync(path.join(target, ".amber", "session-state.json"));
	fs.rmSync(path.join(target, "src", "widget.js"));
	fs.rmSync(path.join(target, "notes-parallel.md"));
	const clean = execSync("git status --porcelain", { cwd: target, encoding: "utf8" });
	assert.equal(clean, "", "cleanup restored the committed state");
	assert.doesNotMatch(renderHandoff(target), /Dirty worktree/);

	fs.rmSync(target, { recursive: true, force: true });
});

// Review fixes (Standards axis): typechange status, quoted-escape preservation,
// and the handoff file itself as managed churn.
test("session-handoff.md is Amber-managed, not outside-scope noise", () => {
	const c = classifyDirtyPaths(["session-handoff.md", "src/other.js"], {
		featurePaths: ["src/other.js"],
	});
	assert.deepEqual(c.managed, ["session-handoff.md"]);
	assert.deepEqual(c.focusWork, ["src/other.js"]);
	assert.deepEqual(c.outsideScope, []);
});
