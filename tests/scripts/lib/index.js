/**
 * Shared library for integration tests.
 *
 * Provides lightweight utilities consumed by test harnesses and scenario tests.
 */

const fs = require("fs");
const path = require("path");

/**
 * Ensure a directory exists (mkdir -p).
 * @param {string} dir
 */
function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

/**
 * Safely remove a directory tree.
 * @param {string} dir
 */
function removeDir(dir) {
	if (fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Read a JSON file.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJSON(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

/**
 * Read a JSONL file into an array of objects.
 * @param {string} filePath
 * @returns {object[]}
 */
function readJSONL(filePath) {
	if (!fs.existsSync(filePath)) return [];
	return fs
		.readFileSync(filePath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/**
 * Resolve a path relative to the project root (two levels above tests/scripts).
 * @param {...string} segments
 * @returns {string}
 */
function projectPath(...segments) {
	return path.resolve(__dirname, "..", "..", "..", ...segments);
}

module.exports = {
	ensureDir,
	removeDir,
	readJSON,
	readJSONL,
	projectPath,
};
