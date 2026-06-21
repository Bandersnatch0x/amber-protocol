"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	writeAdoptionBundleArtifact,
} = require("../../scripts/lib/core/adoption-composer/index");

function tempDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function makeBundle(manifest, extraFiles = {}) {
	const dir = tempDir("aba-bundle");
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
	for (const [name, content] of Object.entries(extraFiles)) {
		fs.writeFileSync(path.join(dir, name), content);
	}
	return dir;
}

function outputPath() {
	return path.join(tempDir("aba-out"), "artifact.md");
}

// Minimal spec whose build/render echo the manifest, so the tests exercise the
// pipeline (validation, manifest load, write) rather than any real artifact.
function spec(overrides = {}) {
	return {
		command: "adoption test-artifact",
		outputExistsLabel: "Test artifact",
		emptyResult: (fields, errors, warnings) => ({
			kind: "error",
			...fields,
			errors,
			warnings,
		}),
		build: (manifest, ctx) => ({
			kind: "test-artifact",
			target: manifest.target,
			bundleDir: ctx.bundleDir,
			outputPath: ctx.outputPath,
			errors: ctx.errors,
			warnings: ctx.warnings,
		}),
		render: (record) => `# ${record.kind}\n${record.target}\n`,
		...overrides,
	};
}

test("requires --bundle-dir", () => {
	const result = writeAdoptionBundleArtifact({ output: outputPath() }, spec());
	assert.ok(
		result.errors.includes("adoption test-artifact requires --bundle-dir."),
	);
});

test("requires --output", () => {
	const dir = makeBundle({ target: "/tmp/repo" });
	const result = writeAdoptionBundleArtifact({ bundleDir: dir }, spec());
	assert.ok(
		result.errors.includes("adoption test-artifact requires --output."),
	);
});

test("reports a non-existent bundle directory", () => {
	const missing = path.join(tempDir("aba-missing"), "nope");
	const result = writeAdoptionBundleArtifact(
		{ bundleDir: missing, output: outputPath() },
		spec(),
	);
	assert.ok(
		result.errors.some((message) =>
			message.startsWith("Bundle directory does not exist:"),
		),
	);
});

test("refuses to overwrite an existing output", () => {
	const dir = makeBundle({ target: "/tmp/repo" });
	const out = outputPath();
	fs.writeFileSync(out, "existing");
	const result = writeAdoptionBundleArtifact(
		{ bundleDir: dir, output: out },
		spec(),
	);
	assert.ok(
		result.errors.some((message) =>
			message.startsWith("Test artifact already exists:"),
		),
	);
});

test("reports a missing bundle manifest", () => {
	const dir = tempDir("aba-empty");
	const result = writeAdoptionBundleArtifact(
		{ bundleDir: dir, output: outputPath() },
		spec(),
	);
	assert.ok(
		result.errors.some((message) =>
			message.startsWith("Bundle manifest is missing:"),
		),
	);
});

test("reports an unreadable bundle manifest", () => {
	const dir = tempDir("aba-bad");
	fs.writeFileSync(path.join(dir, "manifest.json"), "{not json");
	const result = writeAdoptionBundleArtifact(
		{ bundleDir: dir, output: outputPath() },
		spec(),
	);
	assert.ok(
		result.errors.some((message) =>
			message.startsWith("Cannot read bundle manifest:"),
		),
	);
});

test("runs the validate hook before the existence checks", () => {
	const dir = makeBundle({ target: "/tmp/repo" });
	const result = writeAdoptionBundleArtifact(
		{ bundleDir: dir, output: outputPath() },
		spec({ validate: () => ["needs --dry-run"] }),
	);
	assert.equal(result.errors[0], "needs --dry-run");
});

test("loads the manifest, writes rendered content, and returns the record", () => {
	const dir = makeBundle({ target: "/tmp/repo" });
	const out = path.join(tempDir("aba-out"), "nested", "artifact.md");
	const record = writeAdoptionBundleArtifact(
		{ bundleDir: dir, output: out },
		spec(),
	);
	assert.equal(record.kind, "test-artifact");
	assert.equal(record.target, "/tmp/repo");
	assert.equal(record.bundleDir, path.resolve(dir));
	assert.equal(fs.readFileSync(out, "utf8"), "# test-artifact\n/tmp/repo\n");
});

test("ctx.readBundleFile reads bundle files and is empty when absent", () => {
	const dir = makeBundle({ target: "/tmp/repo" }, { "gate.md": "# Gate\n" });
	let seenGate;
	let seenMissing;
	writeAdoptionBundleArtifact(
		{ bundleDir: dir, output: outputPath() },
		spec({
			build: (manifest, ctx) => {
				seenGate = ctx.readBundleFile("gate.md");
				seenMissing = ctx.readBundleFile("absent.md");
				return { kind: "x", target: manifest.target };
			},
		}),
	);
	assert.equal(seenGate, "# Gate\n");
	assert.equal(seenMissing, "");
});

test("returns the empty result with manifest target when build records errors", () => {
	const dir = makeBundle({ target: "/tmp/repo" });
	const out = outputPath();
	const result = writeAdoptionBundleArtifact(
		{ bundleDir: dir, output: out },
		spec({
			build: (manifest, ctx) => {
				ctx.errors.push("bad selection");
				return null;
			},
		}),
	);
	assert.deepEqual(result.errors, ["bad selection"]);
	assert.equal(result.target, "/tmp/repo");
	assert.equal(fs.existsSync(out), false);
});
