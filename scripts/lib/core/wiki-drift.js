"use strict";

// Wiki drift: aggregate three wiki-health signals into one status view. All
// three are dimensions doctor does NOT cover (doctor does structure via
// validateWiki: broken links + Unknowns sections). Here we report:
//   staleDocs          content staleness (Last Reviewed marker -> maintenance)
//   missingRequired    REQUIRED_STARTER_WIKI_FILES absent on disk (page-set gap)
//   controlledDrifted  controlled wiki files whose shipped template moved on (SP1)
// Detection only — no wiki content is edited (refresh-vs-preserve respected).
// Unlike scaffold/artifact drift this is marker/file/provenance based, NOT git
// anchored, so non-git projects are NOT skipped.
const path = require("node:path");
const { resolveTarget, pathExists } = require("./fs-utils");
const { classifyTarget } = require("./target-classification");
const { REQUIRED_HARNESS_FILES } = require("./constants");
const { staleDocs: detectStaleDocs } = require("../maintenance");
const { detectScaffoldDrift } = require("./scaffold-version-drift");

function detectWikiDrift(target) {
	const targetRoot = resolveTarget(target);

	if (classifyTarget(targetRoot).type === "product-repo") {
		return { target: targetRoot, available: false, note: "n/a (product-repo)" };
	}
	if (!pathExists(path.join(targetRoot, "docs", "wiki"))) {
		return { target: targetRoot, available: false, note: "no wiki — run `amber wiki --target .`" };
	}

	const stale = detectStaleDocs(targetRoot);
	// Only the wiki subset of required harness files belongs in WIKI drift — a
	// missing AGENTS.md/feature_list.json is a harness gap, not wiki drift.
	const wikiRequired = REQUIRED_HARNESS_FILES.filter((rel) =>
		rel.startsWith("docs/wiki/"),
	);
	const missingRequired = wikiRequired.filter(
		(rel) => !pathExists(path.join(targetRoot, rel)),
	);

	let controlledDriftedFiles = [];
	const scaffold = detectScaffoldDrift(targetRoot);
	if (scaffold.installed && Array.isArray(scaffold.files)) {
		controlledDriftedFiles = scaffold.files.filter(
			(f) =>
				f.tier === "controlled" &&
				f.classification === "stale" &&
				f.path.startsWith("docs/wiki/"),
		);
	}

	return {
		target: targetRoot,
		available: true,
		counts: {
			staleDocs: stale.staleDocs.length,
			missingRequired: missingRequired.length,
			controlledDrifted: controlledDriftedFiles.length,
		},
		missingRequired,
		controlledDrifted: controlledDriftedFiles.map((f) => f.path),
	};
}

module.exports = { detectWikiDrift };
