"use strict";

// Health checks for accepted context pages (ADR-0009 D8). `amber context
// verify` is the authority: per-page status and code-carrying findings, plus a
// summary. Read-only — it never writes pages or the index.

const fs = require("node:fs");

const { listPages, readPage, indexPath } = require("./context-store");
const { inspectPageHealth } = require("./context-page-health");
const { finding } = require("./context-sources");

function checkPage(targetRoot, page) {
	const pageId = page.pageId;
	const health = inspectPageHealth(targetRoot, page);

	// Orphan check: page must appear in the regenerated index.
	const index = indexPath(targetRoot);
	let orphaned = false;
	if (fs.existsSync(index)) {
		const text = fs.readFileSync(index, "utf8");
		if (!text.split("\n").some((line) => line.startsWith(`| ${pageId} |`))) orphaned = true;
	} else {
		orphaned = true;
	}
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
	if (orphaned) {
		findings.push(
			finding("AMBER_E_CONTEXT_PAGE_ORPHANED", `page ${pageId} is missing from ${index}`, pageId),
		);
	}

	return {
		...health,
		status: health.status === "ok" && orphaned ? "orphaned" : health.status,
		findings,
	};
}

/**
 * Verify all accepted pages.
 * @returns {{ pages: Array, summary: Object }}
 */
function verifyPages(targetRoot) {
	const pages = listPages(targetRoot)
		.map(({ pageId }) => readPage(targetRoot, pageId))
		.filter(Boolean);
	const checked = pages.map((page) => checkPage(targetRoot, page));
	const summary = {
		total: checked.length,
		ok: checked.filter((p) => p.status === "ok").length,
		stale: checked.filter((p) => p.status === "stale").length,
		tampered: checked.filter((p) => p.status === "tampered").length,
		obsolete: checked.filter((p) => p.status === "obsolete").length,
		orphaned: checked.filter((p) => p.status === "orphaned").length,
		errors: checked.reduce((acc, p) => acc + p.findings.length, 0),
	};
	return { pages: checked, summary };
}

module.exports = { verifyPages, checkPage };
