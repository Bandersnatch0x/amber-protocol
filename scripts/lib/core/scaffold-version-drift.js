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
const fs = require("node:fs");
const path = require("node:path");
const { TEMPLATE_ROOT } = require("./constants");
const { pathExists } = require("./fs-utils");
const {
	computeTemplateHash,
	templateManagedFiles,
	fileTier,
	loadProvenance,
	writeProvenance,
} = require("./scaffold-provenance");
const { statePathForCreate } = require("../state-dir-resolver");

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
		result.note =
			"No install provenance found. Run `amber init` to enable scaffold-drift detection.";
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

// Refresh Amber-owned scaffold files. Overwrites ONLY files that are BOTH
// tier "controlled" AND classified "stale" (provenance proves the user never
// edited them). Customized/ambiguous controlled files are NEVER overwritten —
// their new template is cached under .amber/maintenance/proposals for manual
// merge. Authored and state files are never touched. After overwriting, the
// refreshed files' provenance baseline is re-stamped to the new (shipped) hash
// so the next run classifies them fresh instead of customized. The overwrite
// set is fixed by fileTier() (AMBER_CONTROLLED_CONTENT_FILES) — there is no
// path-list parameter, by design.
function refreshAmberOwnedFiles(targetRoot, { templateRoot = TEMPLATE_ROOT } = {}) {
	const drift = detectScaffoldDrift(targetRoot, { templateRoot });
	const refreshed = [];
	const proposals = [];

	if (!drift.installed) {
		return { refreshed, proposals, note: drift.note };
	}

	const provenance = loadProvenance(targetRoot);
	let changed = false;

	for (const f of drift.files) {
		if (f.classification !== "stale" || f.tier !== "controlled") continue;
		const dest = path.join(targetRoot, f.path);
		const bak = dest + ".bak";
		if (!pathExists(bak)) fs.copyFileSync(dest, bak);
		fs.copyFileSync(path.join(templateRoot, f.path), dest);
		if (provenance) {
			provenance.files[f.path] = { templateHash: computeTemplateHash(dest), tier: f.tier };
			changed = true;
		}
		refreshed.push(f.path);
	}

	for (const f of drift.files) {
		if (f.tier !== "controlled") continue;
		if (f.classification === "customized" || f.classification === "ambiguous") {
			// Proposals are freshly created artifacts (like maintenance-propose),
			// so the create policy (always .amber) applies.
			const proposalDir = statePathForCreate(targetRoot, "maintenance", "proposals");
			fs.mkdirSync(proposalDir, { recursive: true });
			fs.copyFileSync(
				path.join(templateRoot, f.path),
				path.join(proposalDir, f.path.replace(/\//g, "__") + ".new"),
			);
			proposals.push(f.path);
		}
	}

	if (changed && provenance) {
		provenance.recordedAt = new Date().toISOString();
		writeProvenance(targetRoot, provenance);
	}

	return { refreshed, proposals };
}

module.exports = { detectScaffoldDrift, refreshAmberOwnedFiles };
