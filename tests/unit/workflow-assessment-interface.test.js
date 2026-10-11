"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const MODULE_ROOT = path.join(REPO_ROOT, "scripts", "lib", "workflow-assessment");
const INTERNAL_ROOT = path.join(MODULE_ROOT, "internal");

function listJavaScriptFiles(root) {
	const files = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const filePath = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...listJavaScriptFiles(filePath));
		else if (entry.name.endsWith(".js")) files.push(filePath);
	}
	return files;
}

function requireSpecifiers(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const specifiers = [];
	const pattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
	let match;
	while ((match = pattern.exec(source)) !== null) {
		specifiers.push(match[1]);
	}
	return specifiers;
}

/** True when specifier, resolved against dirname, lands inside internal/. */
function resolvesIntoInternal(dirname, specifier) {
	if (!specifier.startsWith(".")) return false;
	const resolved = path.resolve(dirname, specifier);
	const rel = path.relative(INTERNAL_ROOT, resolved);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function internalConsumers(root) {
	const consumers = [];
	for (const filePath of listJavaScriptFiles(root)) {
		const specifiers = requireSpecifiers(filePath);
		if (specifiers.some((specifier) => resolvesIntoInternal(path.dirname(filePath), specifier))) {
			consumers.push(filePath);
		}
	}
	return consumers;
}

function relative(filePath) {
	return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
}

test("Workflow Effectiveness root exposes only its facade", () => {
	const rootFiles = fs
		.readdirSync(MODULE_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
		.map((entry) => entry.name)
		.sort();

	assert.deepEqual(rootFiles, ["index.js"]);
});

test("production modules cannot import Workflow Effectiveness internals", () => {
	// Resolves real require() targets (not substring matching) so aliases,
	// re-exports, and separator variants cannot smuggle internal imports.
	const scriptsRoot = path.join(REPO_ROOT, "scripts", "lib");
	const violations = internalConsumers(scriptsRoot)
		.filter((filePath) => !filePath.startsWith(`${MODULE_ROOT}${path.sep}`))
		.map(relative)
		.sort();

	assert.deepEqual(violations, []);
});

test("only the internal contract suite may import Workflow Effectiveness internals", () => {
	const testsRoot = path.join(REPO_ROOT, "tests");
	const thisFile = path.resolve(__filename);
	const consumers = internalConsumers(testsRoot)
		.filter((filePath) => path.resolve(filePath) !== thisFile)
		.map(relative)
		.sort();

	assert.deepEqual(consumers, ["tests/unit/workflow-assessment.test.js"]);
});

// ── Report-loading contract: missing vs corrupt reports ──

const { workflowDispatch } = require("../../scripts/lib/workflow-assessment/adapters/command");

function writeTempFile(t, name, content) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-interface-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, content, "utf8");
	return filePath;
}

test("findings with a nonexistent report returns a read failure, not Invalid JSON", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "wf-missing-"));
	const missing = path.join(target, "nope.json");
	const result = workflowDispatch("findings", target, { report: missing });
	assert.match(result.errors[0], /^Unable to read report /);
	assert.match(result.errors[0], /ENOENT/);
	fs.rmSync(target, { recursive: true, force: true });
});

test("compare with a corrupt report returns Invalid JSON", (t) => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "wf-interface-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));
	const baseline = path.join(target, "baseline.json");
	const corrupt = path.join(target, "corrupt.json");
	fs.writeFileSync(baseline, JSON.stringify({ schemaVersion: "1.0.0" }), "utf8");
	fs.writeFileSync(corrupt, "{ not json !!", "utf8");
	const result = workflowDispatch("compare", target, { baseline, current: corrupt });
	assert.match(result.errors[0], /^Invalid JSON in report /);
});

test("plan with a nonexistent report returns a read failure, not a crash", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "wf-missing-"));
	const missing = path.join(target, "nope.json");
	const result = workflowDispatch("plan", target, { report: missing, finding: "x" });
	assert.match(result.errors[0], /^Unable to read report /);
	fs.rmSync(target, { recursive: true, force: true });
});

test("plan with a corrupt report returns Invalid JSON", (t) => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "wf-interface-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));
	const corrupt = path.join(target, "corrupt.json");
	fs.writeFileSync(corrupt, "{ nope !!", "utf8");
	const result = workflowDispatch("plan", target, { report: corrupt, finding: "x" });
	assert.match(result.errors[0], /^Invalid JSON in report /);
});

test("plan falls back to the dispatch target when the report lacks a target", (t) => {
	const report = writeTempFile(t, "report.json", JSON.stringify({ findings: [] }));
	// No finding present → domain error path; must still carry the dispatch target.
	const target = path.dirname(report);
	const result = workflowDispatch("plan", target, { report, finding: "nope" });
	assert.equal(result.target, target);
});
