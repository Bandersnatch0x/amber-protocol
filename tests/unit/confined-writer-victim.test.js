"use strict";

// Red-when-removed behavior tests for the shared-inode guard on the four
// target-resolved write sites migrated to the confined writer seam
// (issue #362, escapes A-D), plus the session timeline append (0158, Site E).
// Each test plants a hard link whose leaf is inside the target but whose
// bytes are shared with a file outside the target, runs the real command
// surface, and asserts the refusal both happens (expected error) and is
// inert (outside victim bytes unchanged). Remove the guard and the write
// goes through the shared inode, corrupting the outside file — each test
// goes red.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { run } = require("../../scripts/amber");
const { refreshAmberOwnedFiles } = require("../../scripts/lib/core/scaffold-version-drift");
const {
	buildProvenance,
	writeProvenance,
	templateManagedFiles,
} = require("../../scripts/lib/core/scaffold-provenance");
const { acceptPlan } = require("../../scripts/lib/core/planning");
const { appendSessionEvent } = require("../../scripts/lib/session-timeline");

function tempDir(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-shared-inode-${label}-`));
}

function readOutside(victimPath) {
	return fs.readFileSync(victimPath, "utf8");
}

// Scaffold-drift fixtures (scaffold-version-drift.test.js helpers): amber.md is
// the one controlled file; install + stamp provenance, then move the template
// on to make the installed copy stale.
function fakeTemplateRoot() {
	const root = tempDir("tpl");
	fs.mkdirSync(path.join(root, "docs/wiki/agent"), { recursive: true });
	fs.mkdirSync(path.join(root, ".amber/continuous-improvement"), { recursive: true });
	fs.writeFileSync(path.join(root, "docs/wiki/agent/amber.md"), "amber v1\n");
	fs.writeFileSync(path.join(root, "AGENTS.md"), "agents v1\n");
	fs.writeFileSync(path.join(root, ".amber/continuous-improvement/state.json"), "{}\n");
	return root;
}

function install(tpl, target) {
	for (const rel of templateManagedFiles(tpl)) {
		const dest = path.join(target, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(tpl, rel), dest);
	}
}

function withProvenance(target, tpl, inferred = false) {
	writeProvenance(target, buildProvenance(target, { templateRoot: tpl, inferred }));
}

function makeStale(tpl, target) {
	install(tpl, target);
	withProvenance(target, tpl, false);
	fs.writeFileSync(path.join(tpl, "docs/wiki/agent/amber.md"), "amber v2\n");
}

function assertInertRefusal(thrower, victimPath) {
	assert.throws(thrower, /hard-linked to \d+ paths/);
	assert.equal(
		readOutside(victimPath),
		"user outside\n",
		"the refusal changes no bytes outside the target",
	);
}

test("context benchmark refuses a report file hard-linked outside the target", async () => {
	const target = tempDir("bench");
	const outside = tempDir("bench-out");
	const victim = path.join(outside, "victim.json");
	try {
		// Minimal benchmarkable target: routes + required artifacts + one fresh page.
		fs.mkdirSync(path.join(target, "routes"), { recursive: true });
		fs.writeFileSync(
			path.join(target, "routes", "bugfix-quick.route.json"),
			JSON.stringify({ routeId: "bugfix-quick", schemaVersion: "1.0.0", stages: [] }),
			"utf8",
		);
		fs.mkdirSync(path.join(target, "docs", "wiki", "agent"), { recursive: true });
		fs.writeFileSync(
			path.join(target, "docs", "wiki", "agent", "amber.md"),
			"# Amber Operating Manual\n\nStay governed.\n",
			"utf8",
		);
		fs.writeFileSync(
			path.join(target, "docs", "wiki", "agent", "context-loadout.md"),
			"# Context Loadout Definition\n\nLoad required artifacts first.\n",
			"utf8",
		);
		// One fresh page with a mutable code source (same seeding shape as
		// context-loadout.test.js so buildLoadout succeeds inside the fixture).
		fs.mkdirSync(path.join(target, "scripts", "lib", "core"), { recursive: true });
		fs.writeFileSync(
			path.join(target, "scripts", "lib", "core", "probe.js"),
			"const x = 1;\n",
			"utf8",
		);
		const { hashFile } = require("../../scripts/lib/core/context-hash");
		const {
			writePage,
			regenerateIndex,
			eventsPath,
		} = require("../../scripts/lib/core/context-store");
		const h = hashFile(path.join(target, "scripts", "lib", "core", "probe.js"));
		writePage(target, {
			schemaVersion: "1.0.0",
			pageId: "probe-page",
			title: "Probe",
			sources: {
				s1: {
					kind: "code",
					ref: "scripts/lib/core/probe.js",
					rawHash: h.rawHash,
					normHash: h.normHash,
					mutable: true,
				},
			},
			blocks: [{ type: "prose", sources: ["s1"], text: "Probe body." }],
		});
		regenerateIndex(target);
		fs.mkdirSync(path.dirname(eventsPath(target)), { recursive: true });
		fs.writeFileSync(
			eventsPath(target),
			`${JSON.stringify({ kind: "page-written", pageId: "probe-page", at: "2026-08-01T10:00:00.000Z" })}\n`,
			"utf8",
		);

		// Schema-valid benchmark fixture. `expected` deliberately mismatches the
		// real loadout: persistReport runs after the pass/fail determination, so
		// a failing benchmark still reaches the report write we are pinning.
		const fixture = {
			schemaVersion: "1.0.0",
			fixtureId: "shared-inode-probe",
			fixtureRevision: "rev-1",
			mode: "smoke",
			signal: { route: "bugfix-quick" },
			expected: {
				eligiblePages: [],
				pages: [],
				excluded: [],
				requiredArtifacts: [],
				loadout: {
					budgetWords: 4000,
					tiers: { required: [], priority: [], optional: [] },
					pages: [],
					references: [],
					requiredArtifacts: [
						{
							kind: "operating-manual",
							path: "docs/wiki/agent/amber.md",
							rawHash: `sha256:${"a".repeat(64)}`,
							words: 100,
							classification: "internal",
						},
						{
							kind: "route-manifest",
							path: "routes/bugfix-quick.route.json",
							rawHash: `sha256:${"b".repeat(64)}`,
							words: 50,
							classification: "internal",
						},
						{
							kind: "loadout-definition",
							path: "docs/wiki/agent/context-loadout.md",
							rawHash: `sha256:${"c".repeat(64)}`,
							words: 80,
							classification: "internal",
						},
					],
					excluded: [],
					deltaSince: null,
				},
			},
		};
		const fixturePath = path.join(target, "docs", "wiki", "bench-fixture.json");
		fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), "utf8");

		// Plant the shared inode: the report leaf inside the target, the victim outside.
		fs.writeFileSync(victim, "user outside\n", "utf8");
		fs.mkdirSync(path.join(target, ".amber", "context", "benchmarks"), { recursive: true });
		fs.linkSync(
			victim,
			path.join(target, ".amber", "context", "benchmarks", "shared-inode-probe.json"),
		);

		await assert.rejects(
			() =>
				run([
					"context",
					"benchmark",
					"--target",
					target,
					"--fixture",
					"docs/wiki/bench-fixture.json",
					"--mode",
					"smoke",
					"--yes",
				]),
			/hard-linked to \d+ paths/,
		);
		assert.equal(
			readOutside(victim),
			"user outside\n",
			"the refusal changes no bytes outside the target",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// Site B: scaffold refresh overwrites the stale destination (and writes its
// .bak) at a fixed in-target name — a planted link writes through into the
// file outside the target.
test("scaffold refresh refuses a stale destination hard-linked outside the target", () => {
	const tpl = fakeTemplateRoot();
	const target = tempDir("drift");
	const outside = tempDir("drift-out");
	const victim = path.join(outside, "victim.md");
	try {
		makeStale(tpl, target);
		// The stale destination's bytes must equal the provenance baseline
		// ("amber v1") or the drift classification flips to customized and no
		// write happens. Swap the installed file for a link to the outside
		// victim, keeping the bytes the stale check expects.
		fs.writeFileSync(victim, "amber v1\n", "utf8");
		fs.unlinkSync(path.join(target, "docs", "wiki", "agent", "amber.md"));
		fs.linkSync(victim, path.join(target, "docs", "wiki", "agent", "amber.md"));

		assert.throws(
			() => refreshAmberOwnedFiles(target, { templateRoot: tpl }),
			/hard-linked to \d+ paths/,
		);
		assert.equal(
			readOutside(victim),
			"amber v1\n",
			"the refusal changes no bytes outside the target",
		);
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// Site C: scaffold proposals cache a customized controlled file under the
// fixed proposals name `docs__wiki__agent__amber.md.new` — same shared-inode
// escape at a different leaf.
test("scaffold proposal refuses a proposals leaf hard-linked outside the target", () => {
	const tpl = fakeTemplateRoot();
	const target = tempDir("prop");
	const outside = tempDir("prop-out");
	const victim = path.join(outside, "victim.md.new");
	try {
		install(tpl, target);
		withProvenance(target, tpl, false);
		// User edit → customized → proposal copy on next refresh.
		fs.writeFileSync(path.join(target, "docs/wiki/agent/amber.md"), "my custom amber\n");
		fs.writeFileSync(victim, "user outside\n", "utf8");
		fs.mkdirSync(path.join(target, ".amber", "maintenance", "proposals"), { recursive: true });
		fs.linkSync(
			victim,
			path.join(target, ".amber", "maintenance", "proposals", "docs__wiki__agent__amber.md.new"),
		);

		assertInertRefusal(() => refreshAmberOwnedFiles(target, { templateRoot: tpl }), victim);
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// Site D: acceptPlan appends the evolution log at the fixed path
// docs/wiki/engineering/harness-evolution.md.
test("accept plan refuses an evolution log hard-linked outside the target", () => {
	const target = tempDir("accept");
	const outside = tempDir("accept-out");
	const victim = path.join(outside, "victim.md");
	try {
		fs.writeFileSync(
			path.join(target, "feature_list.json"),
			JSON.stringify({
				features: [
					{
						id: "F001",
						title: "one",
						status: "in_progress",
						verification: ["x"],
						evidence: [{ command: "npm test", recordedAt: "2026-08-01" }],
					},
				],
			}),
		);
		const planRel = "docs/plans/p.md";
		fs.mkdirSync(path.join(target, "docs", "plans"), { recursive: true });
		fs.writeFileSync(
			path.join(target, planRel),
			[
				"# Plan: p",
				"",
				"Feature: F001",
				"User Confirmation: confirmed",
				"",
				"## High Level Design",
				"- x",
				"",
				"## Context manifests",
				"- implement: docs/specs/contract.md",
				"- review: docs/adr/0001.md",
				"",
				"## Vertical Slices",
				"- [ ] x",
				"",
				"## Resume Checkpoint",
				"- Resume Point: x",
				"- Blockers: x",
				"- Next Action: x",
				"- Recovery Instructions: x",
				"",
				"## Acceptance Criteria",
				"- guardrails hold; no phase boundary crossing.",
				"",
				"## Verification",
				"- x",
				"",
				"## Evidence Schema",
				"- Command: npm test",
				"- Result: pass",
				"- Date: 2026-08-01",
				"",
			].join("\n"),
		);
		// Context manifests entries are existence-checked against the target.
		fs.mkdirSync(path.join(target, "docs", "specs"), { recursive: true });
		fs.writeFileSync(path.join(target, "docs", "specs", "contract.md"), "### contract\n", "utf8");
		fs.mkdirSync(path.join(target, "docs", "adr"), { recursive: true });
		fs.writeFileSync(path.join(target, "docs", "adr", "0001.md"), "# ADR 1\n", "utf8");
		fs.writeFileSync(victim, "user outside\n", "utf8");
		fs.mkdirSync(path.join(target, "docs", "wiki", "engineering"), { recursive: true });
		fs.linkSync(victim, path.join(target, "docs", "wiki", "engineering", "harness-evolution.md"));

		assertInertRefusal(() => acceptPlan(target, planRel), victim);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// Site E (0158): appendSessionEvent is the governed timeline ledger append;
// its guard matches appendJSONL's. A planted link on the timeline.jsonl leaf
// must be refused inertly.
test("session timeline append refuses a timeline.jsonl hard-linked outside the session dir", () => {
	const sessionDir = tempDir("timeline");
	const outside = tempDir("timeline-out");
	const victim = path.join(outside, "victim.jsonl");
	try {
		fs.writeFileSync(victim, "user outside\n", "utf8");
		fs.mkdirSync(sessionDir, { recursive: true });
		fs.linkSync(victim, path.join(sessionDir, "timeline.jsonl"));

		assertInertRefusal(() => appendSessionEvent(sessionDir, { type: "session_created" }), victim);
	} finally {
		fs.rmSync(sessionDir, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});
