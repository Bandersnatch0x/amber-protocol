"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { REPO_ROOT } = require("./constants");

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

function relativeEscapesRoot(relative) {
	return path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`);
}

function toPortablePath(value) {
	return String(value).replace(/\\/g, "/");
}

function lstatIfPresent(filePath) {
	try {
		return fs.lstatSync(filePath);
	} catch (error) {
		if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
		throw error;
	}
}

function realPathForPotential(filePath, seenLinks = new Set()) {
	let existing = path.resolve(filePath);
	const missingSegments = [];
	let stat = lstatIfPresent(existing);
	while (!stat) {
		const parent = path.dirname(existing);
		if (parent === existing) break;
		missingSegments.unshift(path.basename(existing));
		existing = parent;
		stat = lstatIfPresent(existing);
	}
	if (stat && stat.isSymbolicLink()) {
		if (seenLinks.has(existing)) {
			throw new Error(`Symbolic link cycle detected at ${existing}`);
		}
		seenLinks.add(existing);
		const linked = fs.readlinkSync(existing);
		const linkedPath = path.resolve(path.dirname(existing), linked);
		return path.join(realPathForPotential(linkedPath, seenLinks), ...missingSegments);
	}
	const realpath = fs.realpathSync.native || fs.realpathSync;
	return path.join(realpath(existing), ...missingSegments);
}

function resolvePathWithin(root, candidate, options = {}) {
	const { label = "Path", allowRoot = false, canonicalExisting = false } = options;
	if (typeof candidate !== "string" || candidate.trim() === "") {
		throw new Error(`${label} is required.`);
	}
	const resolvedRoot = path.resolve(root);
	const resolved = path.resolve(resolvedRoot, candidate);
	const relative = path.relative(resolvedRoot, resolved);
	if (relativeEscapesRoot(relative) || (!allowRoot && relative === "")) {
		throw new Error(`${label} is outside the target root: ${candidate}`);
	}

	const realRoot = realPathForPotential(resolvedRoot);
	const realCandidate = realPathForPotential(resolved);
	const realRelative = path.relative(realRoot, realCandidate);
	if (relativeEscapesRoot(realRelative) || (!allowRoot && realRelative === "")) {
		throw new Error(`${label} is outside the target root: ${candidate}`);
	}
	return canonicalExisting && lstatIfPresent(resolved) ? realCandidate : resolved;
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
			throw new Error(`File not found: ${filePath}.`, { cause: e });
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
				{ cause: e },
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

// Prettier-compatible JSON layout. JSON.stringify never collapses containers, so its
// output fails format:check on repos that Prettier-check their JSON. Rules mirror
// Prettier's json printer: tab indent (tabWidth 2), printWidth 100, containers
// collapse to one line when the whole line fits; Prettier does not preserve source
// line breaks in JSON, so fit-based collapse is canonical.
const PRETTIER_TAB_WIDTH = 2;
const PRETTIER_PRINT_WIDTH = 100;

function prettierJsonIndent(level) {
	return "\t".repeat(level);
}

function prettierJsonValue(value, keyPrefix, level) {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	// keyPrefix (e.g. `"evidence": `) sits on the same line as the collapsed
	// value, so it must count toward the fit check or boundary lines collapse
	// where Prettier expands them.
	const indentWidth = level * PRETTIER_TAB_WIDTH;
	const fits = (text) => indentWidth + keyPrefix.length + text.length < PRETTIER_PRINT_WIDTH;
	const isArray = Array.isArray(value);
	if (isArray && value.length === 0) return "[]";
	if (!isArray && Object.keys(value).length === 0) return "{}";
	const innerLevel = level + 1;
	const innerIndent = prettierJsonIndent(innerLevel);
	const entries = isArray
		? value.map((item) => innerIndent + prettierJsonValue(item, "", innerLevel))
		: Object.entries(value).map(
				([k, v]) =>
					innerIndent +
					`${JSON.stringify(k)}: ` +
					prettierJsonValue(v, `${JSON.stringify(k)}: `, innerLevel),
			);
	const collapsed = isArray
		? `[${entries.map((e) => e.trimStart()).join(", ")}]`
		: `{ ${entries.map((e) => e.trimStart()).join(", ")} }`;
	if (fits(collapsed)) return collapsed;
	const opener = isArray ? "[" : "{";
	const closer = isArray ? "]" : "}";
	return `${opener}\n${entries.join(",\n")}\n${prettierJsonIndent(level)}${closer}`;
}

function writeJsonPrettier(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp`;
	fs.writeFileSync(tmp, `${prettierJsonValue(data, "", 0)}\n`);
	fs.renameSync(tmp, filePath);
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
	if (normalized === ".claude/worktrees" || normalized.startsWith(".claude/worktrees/")) {
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
	return toPortablePath(path.relative(from, to));
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
	resolvePathWithin,
	realPathForPotential,
	toPortablePath,
	pathExists,
	readText,
	isMissingPath,
	readJson,
	readJsonSafe,
	writeJson,
	writeJsonPrettier,
	collectFilesBySuffix,
	walkFiles,
	isIgnoredAuditPath,
	walkProjectFiles,
	relativeSlash,
	repoRelativePath,
	fileContains,
};
