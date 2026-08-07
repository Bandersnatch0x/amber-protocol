"use strict";

// Operational statistics over the append-only event log plus current pages
// (ADR-0009 D9). Cost signals: raw-only filter rate, no-change rate. Quality
// signals: ingest pass rate, error-code distribution, unknown-block share,
// mean sources per block.

const { readEvents, listPages, readPage } = require("./context-store");

/**
 * @returns {{
 *   requests: { total: number, byTrigger: Object },
 *   ingests: { total: number, accepted: number, rejected: number, noChange: number },
 *   errorCodes: Object,
 *   rawOnlyChanges: number,
 *   filterRate: number|null,
 *   unknownShare: number|null,
 *   meanSourcesPerBlock: number|null,
 * }}
 */
function computeStats(targetRoot, options = {}) {
	const allEvents = readEvents(targetRoot);
	// Optional window: consider only the most recent N events (observability of
	// trend regressions — lifetime aggregates plateau and hide them).
	const window = Number.isInteger(options.window) && options.window > 0 ? options.window : null;
	const events = window ? allEvents.slice(-window) : allEvents;
	const requests = { total: 0, byTrigger: {} };
	const ingests = { total: 0, accepted: 0, rejected: 0, noChange: 0 };
	const errorCodes = {};
	let rawOnlyChanges = 0;

	for (const ev of events) {
		switch (ev.kind) {
			case "request-created": {
				requests.total += 1;
				const t = ev.trigger || "explicit";
				requests.byTrigger[t] = (requests.byTrigger[t] || 0) + 1;
				break;
			}
			case "ingest": {
				ingests.total += 1;
				if (ev.outcome === "accepted") ingests.accepted += 1;
				else if (ev.outcome === "no-change") ingests.noChange += 1;
				else if (ev.outcome === "rejected") {
					ingests.rejected += 1;
					errorCodes[ev.code || "unknown"] = (errorCodes[ev.code || "unknown"] || 0) + 1;
				}
				break;
			}
			case "source-raw-only-change":
				rawOnlyChanges += 1;
				break;
		}
	}

	// Filter rate: raw-only rebases / (raw-only rebases + refresh requests).
	// Requests with trigger "source-change" are the normalized changes.
	const staleTriggers = requests.byTrigger["source-change"] || 0;
	const filterRate =
		rawOnlyChanges + staleTriggers > 0
			? Math.round((rawOnlyChanges / (rawOnlyChanges + staleTriggers)) * 1000) / 1000
			: null;

	// Quality signals from current pages.
	const pages = listPages(targetRoot).map(({ pageId }) => readPage(targetRoot, pageId)).filter(Boolean);
	let blocks = 0;
	let unknown = 0;
	let sourceRefs = 0;
	for (const p of pages) {
		blocks += (p.blocks || []).length;
		unknown += (p.blocks || []).filter((b) => b.type === "unknown").length;
		sourceRefs += Object.keys(p.sources || {}).length;
	}

	const passRate =
		ingests.total > 0 ? Math.round((ingests.accepted / ingests.total) * 1000) / 1000 : null;
	const noChangeRate =
		ingests.total > 0 ? Math.round((ingests.noChange / ingests.total) * 1000) / 1000 : null;
	const unknownShare = blocks > 0 ? Math.round((unknown / blocks) * 1000) / 1000 : null;
	const meanSourcesPerBlock =
		blocks > 0 ? Math.round((sourceRefs / blocks) * 1000) / 1000 : null;

	return {
		requests,
		ingests: { ...ingests, passRate, noChangeRate },
		errorCodes,
		rawOnlyChanges,
		filterRate,
		unknownShare,
		meanSourcesPerBlock,
		pages: pages.length,
		window,
	};
}

module.exports = { computeStats };
