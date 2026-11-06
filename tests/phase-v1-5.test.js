"use strict";
const { trackTempDir } = require("./helpers/harness");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

const { classifyTarget } = require("../scripts/lib/core/target-classification");
const { inspectProjectProfile } = require("../scripts/lib/core/profiles");
const { inspectWorkflowPack } = require("../scripts/lib/core/workflow-packs");
const { scaffoldHarness } = require("../scripts/lib/core/scaffold");
const memoryStore = require("../scripts/lib/core/memory-store");
const memoryPolicy = require("../scripts/lib/core/memory-policy");

function tempDir(name) {
	return trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), `amber-v1-5-${name}-`)));
}

function runHarness(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}

test("target classification distinguishes product, harnessed, and unharnessed repos", () => {
	const harnessed = tempDir("harnessed");
	const unharnessed = tempDir("unharnessed");
	scaffoldHarness(harnessed);

	assert.equal(classifyTarget(ROOT).type, "product-repo");
	assert.equal(classifyTarget(harnessed).type, "harnessed-target-repo");
	assert.equal(classifyTarget(unharnessed).type, "unharnessed-target-repo");
});

test("doctor reports product-repo status and memory findings on an isolated product repo", () => {
	const repo = tempDir("doctor-product");
	fs.writeFileSync(path.join(repo, "SPEC.md"), "# spec");
	fs.writeFileSync(path.join(repo, "ROADMAP.md"), "# roadmap");
	fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
	fs.writeFileSync(path.join(repo, "scripts", "amber.js"), "// cli");
	fs.mkdirSync(path.join(repo, "templates"), { recursive: true });
	fs.mkdirSync(path.join(repo, "workflow-packs"), { recursive: true });
	fs.mkdirSync(path.join(repo, "profiles"), { recursive: true });
	fs.copyFileSync(
		path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json"),
		path.join(repo, "workflow-packs", "safe-amber-bootstrap.pack.json"),
	);
	fs.copyFileSync(
		path.join(ROOT, "profiles", "default.profile.json"),
		path.join(repo, "profiles", "default.profile.json"),
	);
	fs.writeFileSync(
		path.join(repo, "feature_list.json"),
		JSON.stringify({
			features: [
				{
					id: "F001",
					priority: 1,
					area: "a",
					title: "A",
					user_visible_behavior: "A",
					status: "accepted",
					verification: ["check"],
					evidence: ["npm test"],
					notes: [],
				},
			],
		}),
	);
	fs.writeFileSync(path.join(repo, "MEMORY.md"), "# Memory\n\n## Entries\n");

	const healthy = runHarness(["doctor", "--target", repo, "--json"]);
	assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr);
	const payload = JSON.parse(healthy.stdout);
	assert.equal(payload.classification.type, "product-repo");
	assert.deepEqual(payload.errors, []);
	const healthyText = runHarness(["doctor", "--target", repo]);
	assert.equal(healthyText.status, 0, healthyText.stdout);
	assert.match(healthyText.stdout, /Target type: product-repo/);

	// A drifted active entry is reported, fails the doctor, and the memory
	// layer is checked exactly once.
	fs.writeFileSync(path.join(repo, "source.md"), "current\n");
	const entry = memoryPolicy.withEntryId({
		claim: "drift probe",
		knowledgeKind: "unspecified",
		targetSurface: "MEMORY.md",
		provenance: {
			sources: [
				{
					kind: "file",
					ref: "source.md",
					rawHash: "sha256:" + "0".repeat(64),
					normHash: "sha256:" + "0".repeat(64),
					mutable: true,
				},
			],
		},
	});
	const stamp = new Date().toISOString();
	memoryStore.writeEntry(repo, { ...entry, status: "active", createdAt: stamp, updatedAt: stamp });

	const drifted = runHarness(["doctor", "--target", repo, "--json"]);
	assert.equal(drifted.status, 1, "source drift must fail the doctor");
	const driftedPayload = JSON.parse(drifted.stdout);
	assert.ok(
		driftedPayload.errors.some((e) => e.includes("AMBER_E_MEMORY_SOURCE_STALE")),
		driftedPayload.errors.join("; "),
	);
	assert.equal(
		driftedPayload.productChecks.filter((c) => c.name === "memory-layer").length,
		1,
		"the memory layer must be checked exactly once",
	);
});

test("audit summary uses product-repo mode without root starter gaps", () => {
	const result = runHarness(["audit", "--target", ROOT, "--summary"]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Target type: product-repo/);
	assert.match(result.stdout, /Template starter files: \d+\/\d+ in templates\//);
	assert.doesNotMatch(result.stdout, /Missing Amber starter files:/);
	assert.match(result.stdout, /Suggested additions: 0/);
	assert.match(result.stdout, /Conflicts: 0/);
});

test("sample workflow pack and profile can be inspected without execution", () => {
	const packPath = path.join(ROOT, "workflow-packs", "safe-amber-bootstrap.pack.json");
	const profilePath = path.join(ROOT, "profiles", "default.profile.json");

	const packResult = inspectWorkflowPack(packPath);
	const profileResult = inspectProjectProfile(profilePath);

	assert.deepEqual(packResult.errors, []);
	assert.equal(packResult.execution.executesAnything, false);
	assert.equal(packResult.pack.id, "safe-amber-bootstrap");
	assert.ok(packResult.pack.stepCount > 0);
	assert.deepEqual(profileResult.errors, []);
	assert.ok(profileResult.profile.packIds.includes("safe-amber-bootstrap"));
});
