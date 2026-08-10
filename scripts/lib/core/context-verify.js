"use strict";

// Health checks for accepted context pages (ADR-0009 D8). `amber context
// verify` is the authority: per-page status and code-carrying findings, plus a
// summary. Read-only — it never writes pages or the index.

const fs = require("node:fs");

const { listPages, readPage, indexPath } = require("./context-store");
const { inspectPageHealth } = require("./context-page-health");
const { finding } = require("./context-sources");
const { deriveAssurance } = require("./context-assurance");
const { describeKnowledge } = require("./context-knowledge");
const { projectionStatus } = require("./context-projection");

function checkPage(targetRoot, page) {
	const pageId = page.pageId;
	const health = inspectPageHealth(targetRoot, page);
	const knowledge = describeKnowledge(targetRoot, page);

	const findings = [...health.findings];
	if (health.allMutableSourcesMissing) {
		findings.push(
			finding(
				"AMBER_E_CONTEXT_PAGE_OBSOLETE",
				`every mutable source of ${pageId} is missing`,
				pageId,
			),
		);
	}
	return {
		...health,
		findings,
		assurance: deriveAssurance(targetRoot, page),
		...knowledge,
	};
}

/**
 * Verify all accepted pages.
 * @returns {{ pages: Array, summary: Object }}
 */
function verifyPages(targetRoot) {
	const projection = projectionStatus(targetRoot);
	const pages = listPages(targetRoot)
		.map(({ pageId }) => readPage(targetRoot, pageId))
		.filter(Boolean);
	const checked = pages.map((page) => checkPage(targetRoot, page));
	if (!projection.ok) {
		const index = indexPath(targetRoot);
		const output = fs.existsSync(index) ? fs.readFileSync(index, "utf8") : "";
		for (const page of checked) {
			if (output.split("\n").some((line) => line.startsWith(`| ${page.pageId} |`))) continue;
			page.findings.push(
				finding(
					"AMBER_E_CONTEXT_PAGE_ORPHANED",
					`page ${page.pageId} is missing from incomplete projection ${index}`,
					page.pageId,
				),
			);
			if (page.status === "ok") page.status = "orphaned";
		}
	}
	const summary = {
		total: checked.length,
		ok: checked.filter((p) => p.status === "ok").length,
		stale: checked.filter((p) => p.status === "stale").length,
		tampered: checked.filter((p) => p.status === "tampered").length,
		obsolete: checked.filter((p) => p.status === "obsolete").length,
		orphaned: checked.filter((p) => p.status === "orphaned").length,
		errors: checked.reduce((acc, p) => acc + p.findings.length, 0),
	};
	return {
		ok: projection.ok,
		code: projection.code || null,
		detail: projection.detail,
		projection: projection.ok ? projection.manifest : null,
		pages: checked,
		summary,
	};
}

module.exports = { verifyPages, checkPage };
