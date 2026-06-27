"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { CATALOG, getEntry, listCodes } = require("./core/error-catalog");

function detail(code) {
	const entry = CATALOG[code];
	return [
		`${code} — ${entry.title}`,
		`  Layer: ${entry.layer}`,
		`  Cause: ${entry.cause}`,
		`  Fix:   ${entry.remedy}`,
		entry.related.length ? `  Related: ${entry.related.join(", ")}` : null,
	]
		.filter(Boolean)
		.join("\n");
}

function suggestionsFor(query) {
	const q = String(query || "").toLowerCase();
	return listCodes().filter(
		(code) =>
			code.toLowerCase().includes(q) ||
			CATALOG[code].title.toLowerCase().includes(q),
	);
}

function listAll() {
	const rows = listCodes().map(
		(code) => `  ${code}  [${CATALOG[code].layer}]  ${CATALOG[code].title}`,
	);
	return ["Amber error codes:", ...rows, "", "Run `amber explain <code>` for detail."].join(
		"\n",
	);
}

function renderMarkdown() {
	const header = [
		"## Amber Error Codes",
		"",
		"> Generated from the error catalog. Regenerate with `amber explain --markdown`.",
		"",
		"| Code | Layer | Symptom | Fix |",
		"| --- | --- | --- | --- |",
	];
	const rows = listCodes().map((code) => {
		const e = CATALOG[code];
		return `| \`${code}\` | ${e.layer} | ${e.title} | \`${e.remedy}\` |`;
	});
	return [...header, ...rows, ""].join("\n");
}

function explain(args = {}) {
	if (args.markdown) {
		const out = typeof args.markdown === "string" ? args.markdown : null;
		if (!out) {
			return {
				text: "explain --markdown requires a path.",
				errors: ["explain --markdown requires a path."],
				warnings: [],
			};
		}
		fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
		fs.writeFileSync(out, renderMarkdown());
		return { text: `Wrote error-code reference to ${out}`, errors: [], warnings: [] };
	}

	const query = args._ && args._[0];
	if (!query) {
		return { text: listAll(), errors: [], warnings: [] };
	}

	const entry = getEntry(query);
	if (entry) {
		const code = Object.keys(CATALOG).find((c) => CATALOG[c] === entry);
		return { text: detail(code), errors: [], warnings: [] };
	}

	const suggestions = suggestionsFor(query);
	const text = suggestions.length
		? `Unknown code "${query}". Did you mean:\n${suggestions.map((c) => `  ${c}`).join("\n")}`
		: `Unknown code "${query}". Run \`amber explain\` to list all codes.`;
	return { text, errors: [`Unknown error code: ${query}`], warnings: [] };
}

module.exports = { explain, renderMarkdown };
