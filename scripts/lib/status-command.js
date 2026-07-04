"use strict";

// `amber status` — a thin, curated STATE front-door. Aggregates existing
// primitives into one glance: is this a git repo, is Amber initialized, is the
// install fresh, and a scaffold-drift count rollup. Does NOT run validity checks
// (that's `doctor`) and does NOT duplicate the full maintenance dump
// (`maintenance inspect`). Read-only.
const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget } = require("./core/fs-utils");
const { classifyTarget } = require("./core/target-classification");
const { getRepoSnapshot } = require("./core/git-state");
const { detectScaffoldDrift } = require("./core/scaffold-version-drift");
const { loadProvenance } = require("./core/scaffold-provenance");

function buildStatus(target) {
	const targetRoot = resolveTarget(target);
	const repo = getRepoSnapshot(targetRoot);
	const classification = classifyTarget(targetRoot);

	const amberDir = path.join(targetRoot, ".amber");
	const harnessDir = path.join(targetRoot, ".harness");
	const stateDir = fs.existsSync(amberDir)
		? ".amber"
		: fs.existsSync(harnessDir)
			? ".harness"
			: "none";
	const provenance = loadProvenance(targetRoot);

	let scaffoldDrift;
	if (classification.type === "product-repo") {
		// Templates compared to themselves → meaningless. Skip the detector.
		scaffoldDrift = { note: "n/a (product-repo ships the templates)" };
	} else {
		scaffoldDrift = detectScaffoldDrift(targetRoot);
	}

	let nextStep;
	if (classification.type === "unharnessed-target-repo") {
		nextStep = "Run `amber init --target .` to install Amber.";
	} else if (
		classification.type !== "product-repo" &&
		scaffoldDrift.counts &&
		scaffoldDrift.counts.stale > 0
	) {
		nextStep = "Run `amber sync --target .` to refresh stale scaffold files.";
	} else {
		nextStep =
			"Run `amber maintenance inspect --target .` for the full drift report, or `amber doctor --target .` for validity.";
	}

	return {
		target: targetRoot,
		repo,
		init: {
			classification: classification.type,
			stateDir,
			provenance: provenance
				? {
						present: true,
						inferred: Boolean(provenance.provenanceInferred),
						amberVersion: provenance.amberVersion,
					}
				: { present: false },
		},
		scaffoldDrift,
		nextStep,
	};
}

function renderStatus(s) {
	const lines = [`Target: ${s.target}`];
	lines.push(
		`Repo: ${s.repo.isGit ? `git (${s.repo.branch || "detached"}${s.repo.dirty ? ", dirty" : ""})` : "non-git"}`,
	);
	if (s.repo.isGit && s.repo.lastCommit)
		lines.push(`Last commit: ${s.repo.lastCommit}`);
	lines.push(
		`Init: ${s.init.classification} (state: ${s.init.stateDir}${
			s.init.provenance.present
				? `, provenance ${s.init.provenance.inferred ? "inferred" : "present"}`
				: ", no provenance"
		}})`,
	);
	if (s.scaffoldDrift.counts) {
		const c = s.scaffoldDrift.counts;
		lines.push(
			`Scaffold drift: fresh=${c.fresh} stale=${c.stale} customized=${c.customized} ambiguous=${c.ambiguous} missing=${c.missing}`,
		);
	} else if (s.scaffoldDrift.note) {
		lines.push(`Scaffold drift: ${s.scaffoldDrift.note}`);
	}
	lines.push(`Next: ${s.nextStep}`);
	return lines.join("\n");
}

module.exports = { buildStatus, renderStatus };
