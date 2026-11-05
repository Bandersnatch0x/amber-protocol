"use strict";

// Source-change refresh (ADR-0009 D4/D5). `amber context refresh` scans
// persisted pages, and for each mutable source:
//   - raw-only change  -> silently rebase stored hashes (filtered; no request)
//   - normalized change -> generate a refresh request against current evidence
// Immutable sources are never staleness-checked here.

const fs = require("node:fs");

const { hashFile } = require("./context-hash");
const { resolvePathWithin } = require("./fs-utils");
const {
	listPages,
	readPage,
	readEvents,
	writePage,
	regenerateIndex,
	appendEvent,
} = require("./context-store");
const { createRequest } = require("./context-request");
const { summarizeFreshnessActivity, pageExpiresAt, isTimeExpired } = require("./context-freshness");

function scanPageSources(targetRoot, page) {
	const rebased = { ...page, sources: { ...page.sources } };
	const changedRefs = [];
	const errors = [];
	let rebaseChanged = false;
	for (const [sid, source] of Object.entries(page.sources || {})) {
		if (!source.mutable) continue;
		let full;
		try {
			full = resolvePathWithin(targetRoot, source.ref, { label: "Context source" });
		} catch (error) {
			errors.push(`${page.pageId}: ${error.message || String(error)}`);
			continue;
		}
		if (!fs.existsSync(full)) continue;
		const current = hashFile(full);
		if (current.normHash !== source.normHash) {
			changedRefs.push(source.ref);
			continue;
		}
		if (current.rawHash !== source.rawHash) {
			rebased.sources[sid] = { ...source, rawHash: current.rawHash, normHash: current.normHash };
			rebaseChanged = true;
			appendEvent(targetRoot, {
				kind: "source-raw-only-change",
				pageId: page.pageId,
				sid: source.ref,
			});
		}
	}
	return { rebased, changedRefs, errors, rebaseChanged };
}

// A page needs a refresh request for one of two reasons: its sources changed
// (normalized hash), or its ttl elapsed with no source change. The source
// change wins when both apply — one request covers both.
function createPageRefreshRequest(targetRoot, page, changedRefs, freshness = {}) {
	const reason =
		changedRefs.length > 0 ? "source-change" : freshness.timeExpired ? "ttl-expired" : null;
	if (!reason) return { request: null, errors: [] };
	// The ttl fact rides the request even when a source change supplies the
	// reason: one request covers both triggers, so neither is lost.
	const expiredAt = freshness.timeExpired ? freshness.expiresAt : null;
	const created = createRequest(targetRoot, {
		pageId: page.pageId,
		title: page.title,
		reason,
		sources: Object.values(page.sources).map((source) => ({ ref: source.ref })),
		...(expiredAt ? { expiredAt } : {}),
		force: true,
	});
	if (created.errors.length > 0) {
		return { request: null, errors: created.errors.map((error) => `${page.pageId}: ${error}`) };
	}
	return {
		request: {
			pageId: page.pageId,
			requestId: created.requestId,
			reason,
			changedSources: changedRefs,
			...(expiredAt ? { expiredAt } : {}),
		},
		errors: [],
	};
}

function refreshPage(targetRoot, page, activity, now) {
	const scan = scanPageSources(targetRoot, page);
	let rawOnlyRebase = null;
	if (scan.rebaseChanged) {
		writePage(targetRoot, scan.rebased, { outcome: "raw-only-rebase", reason: "cosmetic" });
		rawOnlyRebase = {
			pageId: page.pageId,
			sources: Object.keys(scan.rebased.sources).filter((sid) => scan.rebased.sources[sid].mutable),
		};
	}
	const expiresAt = pageExpiresAt(page, activity);
	const requestResult = createPageRefreshRequest(targetRoot, page, scan.changedRefs, {
		expiresAt,
		timeExpired: isTimeExpired(expiresAt, now),
	});
	return {
		request: requestResult.request,
		rawOnlyRebase,
		errors: [...scan.errors, ...requestResult.errors],
	};
}

/**
 * Refresh pass.
 * @returns {{ requests: Array, rawOnlyRebases: Array, errors: Array }}
 */
function refreshPages(targetRoot, options = {}) {
	const requests = [];
	const rawOnlyRebases = [];
	const errors = [];

	const pages = listPages(targetRoot)
		.map(({ pageId }) => readPage(targetRoot, pageId))
		.filter(Boolean);
	const activity = summarizeFreshnessActivity(readEvents(targetRoot));
	const now = options.now === undefined ? new Date() : new Date(options.now);

	for (const page of pages) {
		const result = refreshPage(targetRoot, page, activity, now);
		if (result.request) requests.push(result.request);
		if (result.rawOnlyRebase) rawOnlyRebases.push(result.rawOnlyRebase);
		errors.push(...result.errors);
	}

	// Final pass keeps index status accurate when sources changed without a page write.
	regenerateIndex(targetRoot);

	return { requests, rawOnlyRebases, errors };
}

module.exports = { refreshPages };
