"use strict";

// Source-change refresh (ADR-0009 D4/D5). `amber context refresh` scans
// persisted pages, and for each mutable source:
//   - raw-only change  -> silently rebase stored hashes (filtered; no request)
//   - normalized change -> generate a refresh request against current evidence
// Immutable sources are never staleness-checked here.

const fs = require("node:fs");

const { hashFile } = require("./context-hash");
const { resolvePathWithin } = require("./fs-utils");
const { listPages, readPage, writePage, regenerateIndex, appendEvent } = require("./context-store");
const { createRequest } = require("./context-request");

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

function createPageRefreshRequest(targetRoot, page, changedRefs) {
	if (changedRefs.length === 0) return { request: null, errors: [] };
	const created = createRequest(targetRoot, {
		pageId: page.pageId,
		title: page.title,
		reason: "source-change",
		sources: Object.values(page.sources).map((source) => ({ ref: source.ref })),
		force: true,
	});
	if (created.errors.length > 0) {
		return { request: null, errors: created.errors.map((error) => `${page.pageId}: ${error}`) };
	}
	return {
		request: { pageId: page.pageId, requestId: created.requestId, changedSources: changedRefs },
		errors: [],
	};
}

function refreshPage(targetRoot, page) {
	const scan = scanPageSources(targetRoot, page);
	let rawOnlyRebase = null;
	if (scan.rebaseChanged) {
		writePage(targetRoot, scan.rebased, { outcome: "raw-only-rebase", reason: "cosmetic" });
		rawOnlyRebase = {
			pageId: page.pageId,
			sources: Object.keys(scan.rebased.sources).filter((sid) => scan.rebased.sources[sid].mutable),
		};
	}
	const requestResult = createPageRefreshRequest(targetRoot, page, scan.changedRefs);
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
function refreshPages(targetRoot) {
	const requests = [];
	const rawOnlyRebases = [];
	const errors = [];

	const pages = listPages(targetRoot)
		.map(({ pageId }) => readPage(targetRoot, pageId))
		.filter(Boolean);

	for (const page of pages) {
		const result = refreshPage(targetRoot, page);
		if (result.request) requests.push(result.request);
		if (result.rawOnlyRebase) rawOnlyRebases.push(result.rawOnlyRebase);
		errors.push(...result.errors);
	}

	// Final pass keeps index status accurate when sources changed without a page write.
	regenerateIndex(targetRoot);

	return { requests, rawOnlyRebases, errors };
}

module.exports = { refreshPages };
