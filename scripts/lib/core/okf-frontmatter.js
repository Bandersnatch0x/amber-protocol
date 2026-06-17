"use strict";

// Minimal, zero-dependency reader/validator for Google Open Knowledge Format
// (OKF) v0.1 frontmatter. OKF represents knowledge as a directory of Markdown
// files with YAML frontmatter; the only required field is `type`. We keep the
// parser deliberately small (no gray-matter dependency) and tolerant — it
// supports scalars, inline arrays, and block lists, which is all OKF needs.

const OKF_VERSION = "0.1";
const REQUIRED_FIELDS = ["type"];
const RECOMMENDED_FIELDS = ["title", "description"];

function unquote(value) {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function parseScalar(value) {
	const trimmed = value.trim();
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		const inner = trimmed.slice(1, -1).trim();
		if (!inner) {
			return [];
		}
		return inner
			.split(",")
			.map((item) => unquote(item.trim()))
			.filter((item) => item.length > 0);
	}
	return unquote(trimmed);
}

function parseOkfFrontmatter(content) {
	if (typeof content !== "string") {
		return { data: null, body: "" };
	}

	// Frontmatter must be the first thing in the file: --- ... ---
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
	if (!match) {
		return { data: null, body: content };
	}

	const block = match[1];
	const body = content.slice(match[0].length);
	const data = {};
	let currentKey = null;

	for (const line of block.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}

		const listItem = /^\s*-\s+(.*)$/.exec(line);
		if (listItem && currentKey) {
			if (!Array.isArray(data[currentKey])) {
				data[currentKey] = [];
			}
			data[currentKey].push(unquote(listItem[1].trim()));
			continue;
		}

		const keyValue = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (keyValue) {
			const key = keyValue[1];
			const value = keyValue[2];
			currentKey = key;
			data[key] = value.trim() === "" ? "" : parseScalar(value);
		}
	}

	return { data, body };
}

function isEmptyValue(value) {
	return (
		value === undefined ||
		value === null ||
		(typeof value === "string" && value.trim() === "") ||
		(Array.isArray(value) && value.length === 0)
	);
}

function validateOkfFrontmatter(content) {
	const errors = [];
	const warnings = [];
	const { data } = parseOkfFrontmatter(content);

	if (!data) {
		errors.push(
			"missing OKF frontmatter block (expected a leading --- ... --- block with a type field).",
		);
		return { errors, warnings };
	}

	for (const field of REQUIRED_FIELDS) {
		if (isEmptyValue(data[field])) {
			errors.push(`missing required OKF field: ${field}.`);
		}
	}

	for (const field of RECOMMENDED_FIELDS) {
		if (isEmptyValue(data[field])) {
			warnings.push(`missing recommended OKF field: ${field}.`);
		}
	}

	return { errors, warnings };
}

module.exports = {
	OKF_VERSION,
	parseOkfFrontmatter,
	validateOkfFrontmatter,
};
