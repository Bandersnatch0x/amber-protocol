"use strict";

// Source-change refresh (ADR-0009 D4/D5). `amber context refresh` scans
// persisted pages, and for each mutable source:
//   - raw-only change  -> silently rebase stored hashes (filtered; no request)
//   - normalized change -> generate a refresh request against current evidence
// Immutable sources are never staleness-checked here.

const fs = require("node:fs");
const path = require("node:path");

const { hashFile } = require("./context-hash");
const { listPages, readPage, writePage, regenerateIndex, appendEvent } = require("./context-store");
const { createRequest } = require("./context-request");
const { statusMap } = require("./context-verify");

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
		const rebased = { ...page, sources: { ...page.sources } };
		let rebaseChanged = false;
		const changedRefs = [];

		for (const [sid, src] of Object.entries(page.sources || {})) {
			if (!src.mutable) continue;
			const full = path.resolve(targetRoot, src.ref);
			if (!fs.existsSync(full)) continue; // handled by verify (MISSING/OBSOLETE)
			const current = hashFile(full);
			if (current.normHash === src.normHash) {
				if (current.rawHash !== src.rawHash) {
					// Cosmetic change only: rebase silently, count it.
					rebased.sources[sid] = { ...src, rawHash: current.rawHash, normHash: current.normHash };
					rebaseChanged = true;
					appendEvent(targetRoot, { kind: "source-raw-only-change", pageId: page.pageId, sid: src.ref });
				}
			} else {
				changedRefs.push(src.ref);
			}
		}

		if (rebaseChanged) {
			writePage(targetRoot, rebased, { outcome: "raw-only-rebase", reason: "cosmetic" });
			rawOnlyRebases.push({ pageId: page.pageId, sources: Object.keys(rebased.sources).filter((sid) => rebased.sources[sid].mutable) });
		}

		if (changedRefs.length > 0) {
			const created = createRequest(targetRoot, {
				pageId: page.pageId,
				title: page.title,
				reason: "source-change",
				sources: Object.values(page.sources).map((s) => ({ ref: s.ref })),
				force: true, // refresh supersedes any open request for the page
			});
			if (created.errors.length > 0) {
				errors.push(...created.errors.map((e) => `${page.pageId}: ${e}`));
			} else {
				requests.push({ pageId: page.pageId, requestId: created.requestId, changedSources: changedRefs });
			}
		}
	}

	regenerateIndex(targetRoot, statusMap(targetRoot));

	return { requests, rawOnlyRebases, errors };
}

module.exports = { refreshPages };
