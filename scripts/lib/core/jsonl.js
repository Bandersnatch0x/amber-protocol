"use strict";

/**
 * Append-only JSONL ledger primitive (architecture review #4).
 *
 * Every append-only artifact (knowledge records, audit events, phase
 * transitions, context events, loop ledgers) used to re-implement
 * read/append/corruption-policy per module. This module is the single home:
 * one read shape, one append shape, and an explicit per-site corruption
 * policy instead of drift.
 *
 * Policies:
 *   onCorrupt "skip"  — drop the line (projections, transitions)
 *   onCorrupt "throw" — fail closed on any corrupt line (audit ledger)
 *   onCorrupt "mark"  — keep the line as { _unparseable: <line> } (SIEM walks)
 *   missing   "empty" — absent file reads as []
 *   missing   "throw" — absent file is an error
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Read a JSONL file into an array of parsed objects.
 * @param {string} filePath - Absolute path.
 * @param {{onCorrupt?: "skip"|"throw"|"mark", missing?: "empty"|"throw"}} [opts]
 * @returns {Array<object>}
 */
function readJSONL(filePath, { onCorrupt = "skip", missing = "empty" } = {}) {
	if (!fs.existsSync(filePath)) {
		if (missing === "throw") throw new Error(`missing JSONL file: ${filePath}`);
		return [];
	}
	const out = [];
	let lineIndex = 0;
	for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean)) {
		lineIndex += 1;
		try {
			out.push(JSON.parse(line));
		} catch (err) {
			if (onCorrupt === "throw") {
				throw new Error(`corrupt JSONL line ${lineIndex} in ${filePath}`, { cause: err });
			}
			if (onCorrupt === "mark") out.push({ _unparseable: line });
			// "skip" drops the line
		}
	}
	return out;
}

/**
 * Append one object as a JSONL line, creating the parent directory.
 * @param {string} filePath - Absolute path.
 * @param {object} obj - Value to serialize.
 * @returns {object} The appended value.
 */
function appendJSONL(filePath, obj) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
	return obj;
}

/**
 * Overwrite a JSONL file with a set of lines.
 *
 * This is the NON-append tool: it exists for tests (building fixtures) and
 * one-shot rebuilds, not for the append-only production paths — production
 * record/ledger writers must use appendJSONL so lineage is never truncated.
 * @param {string} filePath - Absolute path.
 * @param {Array<object>} objs - Values to serialize.
 */
function writeJSONL(filePath, objs) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, objs.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
}

/**
 * Fold a JSONL file to the current state per key — last line wins, first-seen
 * order preserved. The append-only lineage pattern: later states for the same
 * recordId supersede earlier ones.
 * @param {string} filePath - Absolute path.
 * @param {string} key - Identity field, e.g. "recordId".
 * @param {{onCorrupt?: "skip"|"throw"|"mark"}} [opts]
 * @returns {Array<object>}
 */
function foldJSONL(filePath, key, opts) {
	const byKey = new Map();
	for (const obj of readJSONL(filePath, opts)) {
		if (obj && typeof obj[key] === "string") byKey.set(obj[key], obj);
	}
	return [...byKey.values()];
}

module.exports = {
	readJSONL,
	appendJSONL,
	writeJSONL,
	foldJSONL,
};
