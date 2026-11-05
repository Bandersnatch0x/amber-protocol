"use strict";

// Health checks for accepted context pages (ADR-0009 D8). `amber context
// verify` is the authority: per-page status and code-carrying findings, plus a
// summary. Read-only — it never writes pages or the index.

const fs = require("node:fs");

const { listPages, readPage, readEvents, indexPath } = require("./context-store");
const { inspectPageHealth } = require("./context-page-health");
const { finding } = require("./context-sources");
const { deriveAssurance } = require("./context-assurance");
const { describeKnowledge } = require("./context-knowledge");
const { projectionStatus } = require("./context-projection");
const { summarizeFreshnessActivity, pageExpiresAt, isTimeExpired } = require("./context-freshness");

function checkPage(targetRoot, page, activity = null, now = new Date(), events = null) {
	const pageId = page.pageId;
	const health = inspectPageHealth(targetRoot, page);
	const knowledge = describeKnowledge(targetRoot, page);
	const log = events || readEvents(targetRoot);
	const resolvedActivity = activity || summarizeFreshnessActivity(log);
	const expiresAt = pageExpiresAt(page, resolvedActivity);
	const timeStale = isTimeExpired(expiresAt, now);

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
	if (timeStale) {
		findings.push(
			finding(
				"AMBER_E_CONTEXT_PAGE_TIME_STALE",
				`hard expiry ${expiresAt} has passed (ttl)`,
				pageId,
			),
		);
	}
	// Source-level facts win the status; a page that is both source-stale and
	// time-stale keeps the more specific source status and still carries the
	// time-stale finding. Time is the only reason to leave `ok` here.
	const status = health.status === "ok" && timeStale ? "stale-by-time" : health.status;
	return {
		...health,
		status,
		expiresAt,
		timeStale,
		findings,
		assurance: deriveAssurance(targetRoot, page, log),
		...knowledge,
	};
}

/**
 * Verify all accepted pages.
 * @returns {{ pages: Array, summary: Object }}
 */
function verifyPages(targetRoot, options = {}) {
	const projection = projectionStatus(targetRoot);
	const pages = listPages(targetRoot)
		.map(({ pageId }) => readPage(targetRoot, pageId))
		.filter(Boolean);
	const events = readEvents(targetRoot);
	const activity = summarizeFreshnessActivity(events);
	const now = options.now === undefined ? new Date() : new Date(options.now);
	const checked = pages.map((page) => checkPage(targetRoot, page, activity, now, events));
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
		timeStale: checked.filter((p) => p.status === "stale-by-time").length,
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
