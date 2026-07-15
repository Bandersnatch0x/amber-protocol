"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	REPO_ROOT,
} = require("./constants");

const AUDIT_IGNORED_DIRECTORY_NAMES = new Set([
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

// True when a path argument is absent or blank. Used by command readers to
// reject a missing --file/--contract/--ledger up front with a clear message,
// instead of letting path.resolve(undefined) throw a raw TypeError or
// path.resolve("") fall through to an EISDIR on the current directory.
function isMissingPath(value) {
	return typeof value !== "string" || value.trim() === "";
}

function readJson(filePath) {
	let text;
	try {
		text = readText(filePath);
	} catch (e) {
		if (e.code === "ENOENT") {
			throw new Error(`File not found: ${filePath}.`);
		}
		throw e;
	}
	try {
		return JSON.parse(text);
	} catch (e) {
		if (e instanceof SyntaxError) {
			throw new Error(
				`Failed to parse JSON file: ${filePath}. ${e.message}. ` +
				"The file may be corrupted or contain invalid JSON.",
			);
		}
		throw e;
	}
}

// Read JSON without throwing. Returns {value, error} so callers can degrade
// gracefully instead of crashing. File-not-found returns {value: null, error: null}
// (not an error, just absent). Parse failure returns {value: null, error: string}.
// IMPORTANT: A file containing literal `null` parses successfully and returns
// {value: null, error: null}, so callers must check `!value || typeof value !== 'object'`
// in addition to `error` when expecting an object.
function readJsonSafe(filePath) {
	if (!pathExists(filePath)) {
		return { value: null, error: null };
	}
	try {
		const text = readText(filePath);
		const value = JSON.parse(text);
		return { value, error: null };
	} catch (e) {
		if (e instanceof SyntaxError) {
			return {
				value: null,
				error: `Failed to parse JSON file: ${filePath}. ${e.message}. The file may be corrupted.`,
			};
		}
		return { value: null, error: e.message || String(e) };
	}
}

function writeJson(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function collectFilesBySuffix(root, suffix, ignoredDirNames = new Set()) {
	const files = [];

	function walk(current) {
		if (!pathExists(current)) {
			return;
		}

		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (!ignoredDirNames.has(entry.name)) {
					walk(fullPath);
				}
			} else if (entry.isFile() && (suffix === undefined || fullPath.endsWith(suffix))) {
				files.push(fullPath);
			}
		}
	}

	walk(root);
	return files;
}

// walkFiles is collectFilesBySuffix with no suffix filter and no directory
// ignores - delegate instead of carrying a second recursive walk implementation.
function walkFiles(root) {
	return collectFilesBySuffix(root);
}

function isIgnoredAuditPath(relativePath) {
	const normalized = relativePath.split(path.sep).join("/").toLowerCase();
	const segments = normalized.split("/").filter(Boolean);
	if (segments.some((segment) => AUDIT_IGNORED_DIRECTORY_NAMES.has(segment))) {
		return true;
	}
	if (
		normalized === ".claude/worktrees" ||
		normalized.startsWith(".claude/worktrees/")
	) {
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
	isMissingPath,
	readJson,
	readJsonSafe,
	writeJson,
	collectFilesBySuffix,
	walkFiles,
	isIgnoredAuditPath,
	walkProjectFiles,
	relativeSlash,
	repoRelativePath,
	fileContains,
};
