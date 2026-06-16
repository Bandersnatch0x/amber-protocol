"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	REPO_ROOT,
} = require("./constants");

const AUDIT_IGNORED_DIRECTORY_NAMES = new Set([
	".claude",
	".git",
	".mypy_cache",
	".next",
	".pytest_cache",
	".ruff_cache",
	".tox",
	".venv",
	"__pycache__",
	"build",
	"coverage",
	"dist",
	"env",
	"env_new",
	"node_modules",
	"site-packages",
	"venv",
]);

function resolveTarget(target) {
	return path.resolve(target || process.cwd());
}

function pathExists(filePath) {
	return fs.existsSync(filePath);
}

function readText(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
	return JSON.parse(readText(filePath));
}

function writeJson(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function walkFiles(root) {
	if (!pathExists(root)) {
		return [];
	}

	const entries = fs.readdirSync(root, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(fullPath));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}

	return files;
}

function isIgnoredAuditPath(relativePath) {
	const normalized = relativePath.split(path.sep).join("/").toLowerCase();
	const segments = normalized.split("/").filter(Boolean);
	if (segments.some((segment) => AUDIT_IGNORED_DIRECTORY_NAMES.has(segment))) {
		return true;
	}
	return (
		normalized === "data/reports" ||
		normalized.startsWith("data/reports/") ||
		segments[0] === "results"
	);
}

function walkProjectFiles(root, current = root) {
	if (!pathExists(current)) {
		return [];
	}

	const entries = fs.readdirSync(current, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(current, entry.name);
		const relativePath = relativeSlash(root, fullPath);
		if (entry.isDirectory()) {
			if (isIgnoredAuditPath(relativePath)) {
				continue;
			}
			files.push(...walkProjectFiles(root, fullPath));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}

	return files;
}

function relativeSlash(from, to) {
	return path.relative(from, to).split(path.sep).join("/");
}

function repoRelativePath(filePath) {
	const resolved = path.resolve(filePath);
	if (resolved.startsWith(REPO_ROOT)) {
		return relativeSlash(REPO_ROOT, resolved);
	}
	return resolved;
}

function fileContains(targetRoot, relativePath, pattern) {
	const filePath = path.join(targetRoot, relativePath);
	return pathExists(filePath) && pattern.test(readText(filePath));
}

module.exports = {
	AUDIT_IGNORED_DIRECTORY_NAMES,
	resolveTarget,
	pathExists,
	readText,
	readJson,
	writeJson,
	walkFiles,
	isIgnoredAuditPath,
	walkProjectFiles,
	relativeSlash,
	repoRelativePath,
	fileContains,
};
