"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { checkSourceHealth, stripRange } = require("./context-sources");

function inspectPageHealth(targetRoot, page) {
	const findings = [];
	const pageId = page.pageId;
	const { findings: sourceFindings } = checkSourceHealth(targetRoot, page.sources, pageId);
	findings.push(...sourceFindings);

	let hasMutable = false;
	let mutableMissing = 0;
	let mutableTotal = 0;
	for (const source of Object.values(page.sources || {})) {
		if (!source.mutable) continue;
		hasMutable = true;
		mutableTotal += 1;
		if (!fs.existsSync(path.resolve(targetRoot, stripRange(source.ref)))) {
			mutableMissing += 1;
		}
	}

	const hasStale = findings.some((entry) => entry.code === "AMBER_E_CONTEXT_SOURCE_STALE");
	const tampered = findings.some((entry) => entry.code === "AMBER_E_CONTEXT_SOURCE_TAMPERED");
	const allMutableSourcesMissing =
		hasMutable && mutableTotal > 0 && mutableMissing === mutableTotal;

	let status = "ok";
	if (allMutableSourcesMissing) {
		status = "obsolete";
	} else if (tampered) {
		status = "tampered";
	} else if (hasStale || (hasMutable && mutableMissing > 0)) {
		status = "stale";
	}

	return {
		pageId,
		title: page.title,
		status,
		findings,
		sourceCount: Object.keys(page.sources || {}).length,
		blockCount: (page.blocks || []).length,
		allMutableSourcesMissing,
	};
}

module.exports = { inspectPageHealth };
