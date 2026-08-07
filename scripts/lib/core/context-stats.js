"use strict";

// Operational statistics over the append-only event log plus current pages
// (ADR-0009 D9). Cost signals: raw-only filter rate, no-change rate. Quality
// signals: ingest pass rate, error-code distribution, unknown-block share,
// mean sources per block.

const { readEvents, listPages, readPage } = require("./context-store");

function ratio(numerator, denominator) {
	return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null;
}

function summarizeEvents(events) {
	const requests = { total: 0, byTrigger: {} };
	const ingests = { total: 0, accepted: 0, rejected: 0, noChange: 0 };
	const errorCodes = {};
	let rawOnlyChanges = 0;
	for (const event of events) {
		if (event.kind === "request-created") {
			requests.total += 1;
			const trigger = event.trigger || "explicit";
			requests.byTrigger[trigger] = (requests.byTrigger[trigger] || 0) + 1;
		} else if (event.kind === "ingest") {
			ingests.total += 1;
			if (event.outcome === "accepted") ingests.accepted += 1;
			else if (event.outcome === "no-change") ingests.noChange += 1;
			else if (event.outcome === "rejected") {
				ingests.rejected += 1;
				errorCodes[event.code || "unknown"] = (errorCodes[event.code || "unknown"] || 0) + 1;
			}
		} else if (event.kind === "source-raw-only-change") {
			rawOnlyChanges += 1;
		}
	}
	return { requests, ingests, errorCodes, rawOnlyChanges };
}

function summarizePageQuality(targetRoot) {
	const pages = listPages(targetRoot)
		.map(({ pageId }) => readPage(targetRoot, pageId))
		.filter(Boolean);
	let blocks = 0;
	let unknown = 0;
	let sourceRefs = 0;
	for (const page of pages) {
		blocks += (page.blocks || []).length;
		unknown += (page.blocks || []).filter((block) => block.type === "unknown").length;
		sourceRefs += Object.keys(page.sources || {}).length;
	}
	return {
		pages: pages.length,
		unknownShare: ratio(unknown, blocks),
		meanSourcesPerBlock: ratio(sourceRefs, blocks),
	};
}

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
	const { requests, ingests, errorCodes, rawOnlyChanges } = summarizeEvents(events);

	// Filter rate: raw-only rebases / (raw-only rebases + refresh requests).
	// Requests with trigger "source-change" are the normalized changes.
	const staleTriggers = requests.byTrigger["source-change"] || 0;
	const filterRate = ratio(rawOnlyChanges, rawOnlyChanges + staleTriggers);
	const quality = summarizePageQuality(targetRoot);
	const passRate = ratio(ingests.accepted, ingests.total);
	const noChangeRate = ratio(ingests.noChange, ingests.total);

	return {
		requests,
		ingests: { ...ingests, passRate, noChangeRate },
		errorCodes,
		rawOnlyChanges,
		filterRate,
		unknownShare: quality.unknownShare,
		meanSourcesPerBlock: quality.meanSourcesPerBlock,
		pages: quality.pages,
		window,
	};
}

module.exports = { computeStats };
