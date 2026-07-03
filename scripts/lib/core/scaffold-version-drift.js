"use strict";

// Scaffold-version drift detector. For every template-managed file, classify it
// against install provenance + the currently-shipped template:
//   fresh       installed == shipped                          (no-op)
//   stale       unchanged since install, template moved on    (safe overwrite)
//   customized  changed since install                          (patch only)
//   ambiguous   no reliable baseline (inferred migration)      (treat as customized)
//   missing     deleted since install                          (re-create or ignore)
// Under inferred provenance we refuse to call a differing file "stale" — we
// cannot prove the user never edited it, so "ambiguous" is the honest call.
const path = require("node:path");
const { TEMPLATE_ROOT } = require("./constants");
const { pathExists } = require("./fs-utils");
const {
	computeTemplateHash,
	templateManagedFiles,
	fileTier,
	loadProvenance,
} = require("./scaffold-provenance");

function detectScaffoldDrift(targetRoot, { templateRoot = TEMPLATE_ROOT } = {}) {
	const provenance = loadProvenance(targetRoot);
	const result = {
		target: targetRoot,
		installed: Boolean(provenance),
		amberVersion: provenance ? provenance.amberVersion : null,
		provenanceInferred: provenance ? Boolean(provenance.provenanceInferred) : false,
		files: [],
		counts: { fresh: 0, stale: 0, customized: 0, ambiguous: 0, missing: 0 },
		refreshCommand: `node scripts/amber.js init --target ${JSON.stringify(targetRoot)} --refresh-amber-owned`,
	};

	if (!provenance) {
		result.note = "No install provenance found. Run `amber init` to enable scaffold-drift detection.";
		return result;
	}

	const inferred = Boolean(provenance.provenanceInferred);

	for (const rel of templateManagedFiles(templateRoot)) {
		const installedPath = path.join(targetRoot, rel);
		if (!pathExists(installedPath)) {
			result.files.push({ path: rel, tier: fileTier(rel), classification: "missing" });
			result.counts.missing++;
			continue;
		}
		const installedHash = computeTemplateHash(installedPath);
		const shippedHash = computeTemplateHash(path.join(templateRoot, rel));
		const entry = provenance.files[rel];

		let classification;
		if (installedHash === shippedHash) {
			classification = "fresh";
		} else if (inferred || !entry) {
			classification = "ambiguous";
		} else if (installedHash === entry.templateHash) {
			classification = "stale";
		} else {
			classification = "customized";
		}

		result.files.push({ path: rel, tier: fileTier(rel), classification });
		result.counts[classification]++;
	}

	return result;
}

module.exports = { detectScaffoldDrift };
