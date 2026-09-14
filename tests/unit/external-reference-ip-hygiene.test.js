"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

function git(args) {
	return execFileSync("git", args, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function versionableFiles() {
	return git(["ls-files", "--cached", "--others", "--exclude-standard"])
		.split(/\r?\n/)
		.filter(Boolean);
}

function encoded(values) {
	return String.fromCharCode(...values);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Keep the policy vocabulary out of the product tree as well as out of the
// files being scanned. This is deliberately data-driven so a guard cannot
// introduce the very identifiers it forbids.
const FORBIDDEN_TERMS = [
	[109, 97, 116, 116, 112, 111, 99, 107],
	[97, 115, 107, 45, 109, 97, 116, 116],
	[98, 101, 116, 116, 101, 114, 45, 104, 97, 114, 110, 101, 115, 115],
	[98, 101, 116, 116, 101, 114, 32, 104, 97, 114, 110, 101, 115, 115],
	[98, 101, 116, 116, 101, 114, 104, 97, 114, 110, 101, 115, 115],
	[115, 117, 112, 101, 114, 112, 111, 119, 101, 114, 115],
	[116, 114, 101, 108, 108, 105, 115],
	[103, 114, 111, 107],
	[115, 116, 105, 116, 99, 104],
	[105, 109, 112, 101, 99, 99, 97, 98, 108, 101],
	[113, 111, 100, 101, 114],
	[99, 111, 98, 117, 115, 103, 114, 101, 121, 108, 105, 110, 103],
	[119, 111, 114, 107, 98, 117, 100, 100, 121],
	[112, 108, 97, 121, 119, 114, 105, 103, 104, 116, 45, 99, 108, 105],
].map(encoded);

const FORBIDDEN_PATTERN = new RegExp(
	[
		...FORBIDDEN_TERMS.map(escapeRegExp),
		`\\b${escapeRegExp(encoded([109, 97, 116, 116]))}\\b`,
	].join("|"),
	"i",
);

const NON_PRODUCT_PREFIXES = [
	`.` + encoded([115, 116, 105, 116, 99, 104]) + "/",
	".workflow/",
	"agent-tools/",
	"docs/research/",
	"docs/" + encoded([115, 117, 112, 101, 114, 112, 111, 119, 101, 114, 115]) + "/",
	"output/",
	"spec-compliance-",
];

function isProductSurface(file) {
	return (
		!NON_PRODUCT_PREFIXES.some((prefix) => file.startsWith(prefix)) &&
		file !== ".gitignore" &&
		file !== ".prettierignore" &&
		file !== "MEMORY.md" &&
		file !== ".claude/settings.local.json"
	);
}

function fileContainsForbiddenTerm(file) {
	const absolute = path.join(ROOT, file);
	if (!fs.existsSync(absolute)) return false;
	const bytes = fs.readFileSync(absolute);
	return FORBIDDEN_PATTERN.test(bytes.toString("utf8"));
}

function productSurfaceFiles() {
	return versionableFiles()
		.filter(isProductSurface)
		.filter((file) => fs.existsSync(path.join(ROOT, file)));
}

test("product surface contains no external tool or author identifiers", () => {
	const offenders = productSurfaceFiles().filter(fileContainsForbiddenTerm);
	assert.deepEqual(offenders, []);
});

test("product surface paths contain no external identifiers", () => {
	const offenders = productSurfaceFiles().filter((file) => FORBIDDEN_PATTERN.test(file));
	assert.deepEqual(offenders, []);
});

test("external tools are not runtime or development dependencies", () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	const dependencyNames = Object.keys({
		...(manifest.dependencies || {}),
		...(manifest.devDependencies || {}),
		...(manifest.optionalDependencies || {}),
	});
	assert.deepEqual(
		dependencyNames.filter((name) => FORBIDDEN_PATTERN.test(name)),
		[],
	);
});
