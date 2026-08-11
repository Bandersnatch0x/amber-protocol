"use strict";

// F013-K3 interface contract: Knowledge Plan root exposes only its facade;
// production modules and ordinary tests cannot import internal/ implementation.
// Mirrors the Workflow Effectiveness interface contract (F013 prior art).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const MODULE_ROOT = path.join(REPO_ROOT, "scripts", "lib", "knowledge-plan");
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

test("Knowledge Plan root exposes only its facade (index.js)", () => {
	const rootFiles = fs
		.readdirSync(MODULE_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
		.map((entry) => entry.name)
		.sort();
	assert.deepEqual(rootFiles, ["index.js"]);
});

test("production modules cannot import Knowledge Plan internals", () => {
	// The legacy compatibility module (core/knowledge-plan.js) is the ONLY
	// sanctioned production consumer OUTSIDE the module tree: it forwards
	// deprecated helper exports for the one deprecation cycle (F013-K3).
	// Files inside the module itself (index.js, adapters, internal) may
	// naturally require internal/.
	const scriptsRoot = path.join(REPO_ROOT, "scripts", "lib");
	const violations = internalConsumers(scriptsRoot)
		.map(relative)
		.filter(
			(filePath) =>
				filePath !== "scripts/lib/core/knowledge-plan.js" &&
				!filePath.startsWith("scripts/lib/knowledge-plan/"),
		)
		.sort();
	assert.deepEqual(violations, []);
});

test("only the legacy compatibility module may import Knowledge Plan internals outside the module tree", () => {
	const scriptsRoot = path.join(REPO_ROOT, "scripts", "lib");
	const consumers = internalConsumers(scriptsRoot)
		.map(relative)
		.filter((filePath) => !filePath.startsWith("scripts/lib/knowledge-plan/"))
		.sort();
	assert.deepEqual(consumers, ["scripts/lib/core/knowledge-plan.js"]);
});

test("ordinary tests cannot import Knowledge Plan internals", () => {
	const testsRoot = path.join(REPO_ROOT, "tests");
	const consumers = internalConsumers(testsRoot).map(relative).sort();
	assert.deepEqual(consumers, []);
});
