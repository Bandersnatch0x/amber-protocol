"use strict";

// Health checks for accepted context pages (ADR-0009 D8). `amber context
// verify` is the authority: per-page status and code-carrying findings, plus a
// summary. Read-only — it never writes pages or the index.

const fs = require("node:fs");
const path = require("node:path");

const { listPages, readPage, indexPath } = require("./context-store");
const { checkSourceHealth, finding, stripRange } = require("./context-sources");

function checkPage(targetRoot, page) {
	const findings = [];
	const pageId = page.pageId;
	const { findings: sourceFindings } = checkSourceHealth(targetRoot, page.sources, pageId);
	findings.push(...sourceFindings);

	let hasMutable = false;
	let mutableMissing = 0;
	let mutableTotal = 0;
	for (const src of Object.values(page.sources || {})) {
		if (!src.mutable) continue;
		hasMutable = true;
		mutableTotal += 1;
		if (!fs.existsSync(path.resolve(targetRoot, stripRange(src.ref)))) {
			mutableMissing += 1;
		}
	}

	// Orphan check: page must appear in the regenerated index.
	const index = indexPath(targetRoot);
	let orphaned = false;
	if (fs.existsSync(index)) {
		const text = fs.readFileSync(index, "utf8");
		if (!text.split("\n").some((line) => line.startsWith(`| ${pageId} |`))) orphaned = true;
	} else {
		orphaned = true;
	}
	if (orphaned) {
		findings.push(finding("AMBER_E_CONTEXT_PAGE_ORPHANED", `page ${pageId} is missing from ${indexPath(targetRoot)}`, pageId));
	}

	const hasStale = findings.some((f) => f.code === "AMBER_E_CONTEXT_SOURCE_STALE");
	const tampered = findings.some((f) => f.code === "AMBER_E_CONTEXT_SOURCE_TAMPERED");

	let status = "ok";
	if (hasMutable && mutableTotal > 0 && mutableMissing === mutableTotal) {
		status = "obsolete";
		findings.push(finding("AMBER_E_CONTEXT_PAGE_OBSOLETE", `every mutable source of ${pageId} is missing`, pageId));
	} else if (tampered) {
		status = "tampered";
	} else if (hasStale || (hasMutable && mutableMissing > 0)) {
		status = "stale";
	} else if (orphaned) {
		status = "orphaned";
	}

	return { pageId, title: page.title, status, findings, sourceCount: Object.keys(page.sources || {}).length, blockCount: (page.blocks || []).length };
}

/**
 * Verify all accepted pages.
 * @returns {{ pages: Array, summary: Object }}
 */
function verifyPages(targetRoot) {
	const pages = listPages(targetRoot).map(({ pageId }) => readPage(targetRoot, pageId)).filter(Boolean);
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

/** pageId -> status map for index regeneration. */
function statusMap(targetRoot) {
	const map = {};
	for (const p of verifyPages(targetRoot).pages) map[p.pageId] = p.status;
	return map;
}

module.exports = { verifyPages, checkPage, statusMap };
