"use strict";
const { trackTempDir } = require("../helpers/harness");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { addFeature, recordFeatureEvidence } = require("../../scripts/lib/feature-commands");
const {
	writeHandoffBundle,
	validateHandoffBundle,
} = require("../../scripts/lib/core/handoff-bundle");

function tempDir(name) {
	return trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), `amber-handoff-bundle-${name}-`)));
}

test("writeHandoffBundle creates the complete continuation artifact set", () => {
	const target = tempDir("write");
	scaffoldHarness(target);
	addFeature(target, { id: "F002", title: "complete delivery loop", area: "product" });
	recordFeatureEvidence(target, {
		feature: "F002",
		command: "npm test",
		result: "passed (exit 0)",
	});

	const result = writeHandoffBundle(target);

	assert.deepEqual(result.errors, []);
	assert.equal(result.files.length, 7);
	for (const rel of [
		"README.md",
		"session-summary.md",
		"verification-evidence.md",
		"next-actions.md",
		"risks.md",
		"recovery-commands.md",
		"manifest.json",
	]) {
		assert.ok(fs.existsSync(path.join(result.outputDir, rel)), `${rel} exists`);
	}

	const manifest = JSON.parse(
		fs.readFileSync(path.join(result.outputDir, "manifest.json"), "utf8"),
	);
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.artifactType, "amber-handoff-bundle");
	assert.ok(manifest.files.includes("next-actions.md"));

	const validation = validateHandoffBundle(result.outputDir);
	assert.equal(validation.valid, true);
	assert.deepEqual(validation.errors, []);
});

for (const { rel, missing } of [
	{ rel: "README.md" },
	{ rel: "manifest.json" },
	{ rel: "manifest.json", missing: true },
]) {
	test(`writeHandoffBundle preflights the ${rel} output link${missing ? " to a missing file" : ""}`, () => {
		const target = tempDir("child-link");
		const outside = tempDir("child-link-out");
		scaffoldHarness(target);
		const outputDir = path.join(target, "out");
		fs.mkdirSync(outputDir, { recursive: true });
		fs.writeFileSync(path.join(outputDir, "user-note.md"), "user note\n");
		if (rel !== "README.md") fs.writeFileSync(path.join(outputDir, "README.md"), "user readme\n");
		const outsideFile = path.join(outside, "victim");
		if (!missing) fs.writeFileSync(outsideFile, "user outside\n");
		fs.symlinkSync(outsideFile, path.join(outputDir, rel), "file");
		const before = fs.readdirSync(outputDir).sort();
		const outsideBefore = fs.readdirSync(outside).sort();

		assert.throws(() => writeHandoffBundle(target, { outputDir }), /outside the target root/);
		assert.deepEqual(fs.readdirSync(outputDir).sort(), before);
		assert.deepEqual(fs.readdirSync(outside).sort(), outsideBefore);
		assert.equal(fs.readFileSync(path.join(outputDir, "user-note.md"), "utf8"), "user note\n");
		if (rel !== "README.md")
			assert.equal(fs.readFileSync(path.join(outputDir, "README.md"), "utf8"), "user readme\n");
		if (!missing) assert.equal(fs.readFileSync(outsideFile, "utf8"), "user outside\n");
	});
}

test("writeHandoffBundle permits an output child link to a file inside the target", () => {
	const target = tempDir("in-target-link");
	scaffoldHarness(target);
	const outputDir = path.join(target, "out");
	fs.mkdirSync(outputDir, { recursive: true });
	const readmeFile = path.join(target, "readme-copy.md");
	fs.writeFileSync(readmeFile, "old\n");
	fs.symlinkSync(readmeFile, path.join(outputDir, "README.md"), "file");
	const result = writeHandoffBundle(target, { outputDir });
	assert.equal(result.structureValid, true);
	assert.match(fs.readFileSync(readmeFile, "utf8"), /Handoff Bundle/);
});

test("writeHandoffBundle keeps new and existing outputs working under an aliased target ancestor", () => {
	const root = tempDir("alias-real");
	const aliases = tempDir("alias-links");
	const target = path.join(root, "repo");
	fs.mkdirSync(target);
	scaffoldHarness(target);
	const alias = path.join(aliases, "parent");
	fs.symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
	const logicalTarget = path.join(alias, "repo");
	fs.mkdirSync(path.join(target, "existing"));
	for (const outputDir of [undefined, "existing", "new/deep"]) {
		const result = writeHandoffBundle(logicalTarget, { outputDir });
		assert.equal(result.structureValid, true);
		assert.equal(result.target, logicalTarget);
		const physicalOutput = path.join(target, outputDir || ".amber/handoff/latest");
		assert.equal(
			JSON.parse(fs.readFileSync(path.join(physicalOutput, "manifest.json"), "utf8")).target,
			logicalTarget,
		);
		assert.match(fs.readFileSync(path.join(physicalOutput, "README.md"), "utf8"), /Handoff Bundle/);
	}
});

test("validateHandoffBundle reports missing required files", () => {
	const target = tempDir("validate");
	const bundleDir = path.join(target, ".amber", "handoff", "latest");
	fs.mkdirSync(bundleDir, { recursive: true });
	fs.writeFileSync(path.join(bundleDir, "README.md"), "# partial\n");

	const validation = validateHandoffBundle(bundleDir);

	assert.equal(validation.valid, false);
	assert.ok(validation.errors.some((error) => error.includes("manifest.json is missing")));
	assert.ok(validation.errors.some((error) => error.includes("session-summary.md is missing")));
});

test("writeHandoffBundle distinguishes structure validity from delivery readiness (#44 AC2)", () => {
	const target = tempDir("block");
	scaffoldHarness(target);
	addFeature(target, { id: "F004", title: "blocked delivery", area: "product" });
	// Force a governance block (unsafe defaultAction=allow) while keeping the
	// bundle structurally complete — structure valid, delivery NOT ready.
	fs.mkdirSync(path.join(target, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(target, ".amber", "governance", "rules.json"),
		JSON.stringify({ defaultAction: "allow", rules: [] }) + "\n",
	);

	const result = writeHandoffBundle(target);

	assert.equal(result.structureValid, true, "all bundle files present + manifest well-formed");
	assert.equal(result.valid, true, "valid remains a structure-valid alias");
	assert.equal(result.decision, "block", "governance decision is block");
	assert.equal(result.deliveryReady, false, "not delivery-ready despite valid structure");
});

test("writeHandoffBundle surfaces recent failed verification attempts with bounded context (#44 AC3)", () => {
	const target = tempDir("failures");
	scaffoldHarness(target);
	addFeature(target, { id: "F005", title: "failing verify", area: "product" });
	// Record a failed verification attempt on a session timeline.
	const sessionDir = path.join(target, ".amber", "sessions", "sess-fail");
	fs.mkdirSync(sessionDir, { recursive: true });
	const { appendSessionEvent } = require("../../scripts/lib/session-timeline");
	appendSessionEvent(sessionDir, {
		type: "verification_failed",
		data: { stage: "verify", command: "npm test", exitCode: 2, stderr: "AssertionError: boom" },
	});

	const result = writeHandoffBundle(target);

	assert.ok(Array.isArray(result.failedVerifications));
	assert.equal(result.failedVerifications.length, 1);
	const fv = result.failedVerifications[0];
	assert.equal(fv.sessionId, "sess-fail");
	assert.equal(fv.command, "npm test");
	assert.equal(fv.exitCode, 2);
	assert.equal(fv.error, "AssertionError: boom");
	assert.equal(typeof fv.timestamp, "string");

	// The failure also appears in the bundle's verification-evidence.md.
	const evidence = fs.readFileSync(path.join(result.outputDir, "verification-evidence.md"), "utf8");
	assert.match(evidence, /Recent Failed Verification Attempts/);
	assert.match(evidence, /npm test/);
});
