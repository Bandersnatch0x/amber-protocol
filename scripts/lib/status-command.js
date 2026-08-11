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
const { detectArtifactDrift } = require("./core/artifact-drift");
const { detectWikiDrift } = require("./core/wiki-drift");

function buildStatus(target) {
	const targetRoot = resolveTarget(target);
	const repo = getRepoSnapshot(targetRoot);
	const classification = classifyTarget(targetRoot);

	const amberDir = path.join(targetRoot, ".amber");
	const harnessDir = path.join(targetRoot, ".harness"); // legacy state dir (pre-.amber Amber)
	const stateDir = fs.existsSync(amberDir)
		? ".amber"
		: fs.existsSync(harnessDir)
			? ".harness" // .amber preferred; legacy .harness fallback
			: "none";
	const provenance = loadProvenance(targetRoot);

	let scaffoldDrift;
	if (classification.type === "product-repo") {
		// Templates compared to themselves → meaningless. Skip the detector.
		scaffoldDrift = { note: "n/a (product-repo ships the templates)" };
	} else {
		scaffoldDrift = detectScaffoldDrift(targetRoot);
	}

	const artifactDrift = detectArtifactDrift(targetRoot);
	const wikiDrift = detectWikiDrift(targetRoot);

	let nextStep;
	if (classification.type === "unharnessed-target-repo") {
		nextStep = "Run `amber init --target .` to install Amber.";
	} else if (artifactDrift.available && artifactDrift.counts.drifted > 0) {
		nextStep =
			"Run `amber feature verify --feature <id>` to re-record evidence for drifted features.";
	} else if (artifactDrift.available && artifactDrift.skippedBreakdown.pathUnknown > 0) {
		nextStep = "Some features declare paths git has never touched — fix feature_list paths.";
	} else if (scaffoldDrift.installed === false) {
		nextStep =
			"Run `amber init --target .` to enable scaffold-drift detection (stamps install provenance).";
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
		artifactDrift,
		wikiDrift,
		nextStep,
	};
}

function renderStatus(s) {
	const lines = [`Target: ${s.target}`];
	const dirtyLabel = !s.repo.dirty
		? ""
		: s.repo.dirtyUntrackedOnly
			? ", dirty (untracked only)"
			: ", dirty";
	lines.push(
		`Repo: ${s.repo.isGit ? `git (${s.repo.branch || "detached"}${dirtyLabel})` : "non-git"}`,
	);
	if (s.repo.isGit && s.repo.lastCommit) lines.push(`Last commit: ${s.repo.lastCommit}`);
	lines.push(
		`Init: ${s.init.classification} (state: ${s.init.stateDir}${
			s.init.provenance.present
				? `, provenance ${s.init.provenance.inferred ? "inferred" : "present"}`
				: ", no provenance"
		})`,
	);
	if (s.scaffoldDrift.installed === false && s.scaffoldDrift.note) {
		// Harnessed but no provenance: the all-zero counts are noise; the note is the signal.
		lines.push(`Scaffold drift: ${s.scaffoldDrift.note}`);
	} else if (s.scaffoldDrift.counts) {
		const c = s.scaffoldDrift.counts;
		lines.push(
			`Scaffold drift: fresh=${c.fresh} stale=${c.stale} customized=${c.customized} ambiguous=${c.ambiguous} missing=${c.missing}`,
		);
	} else if (s.scaffoldDrift.note) {
		lines.push(`Scaffold drift: ${s.scaffoldDrift.note}`);
	}
	if (s.artifactDrift.available) {
		const c = s.artifactDrift.counts;
		lines.push(`Artifact drift: drifted=${c.drifted} aligned=${c.aligned} skipped=${c.skipped}`);
		lines.push("  (aligned = code not newer than evidence; not a re-verification)");
	} else if (s.artifactDrift.note) {
		lines.push(`Artifact drift: ${s.artifactDrift.note}`);
	}
	if (s.wikiDrift.available) {
		const c = s.wikiDrift.counts;
		lines.push(
			`Wiki drift: staleDocs=${c.staleDocs} missingRequired=${c.missingRequired} controlledDrifted=${c.controlledDrifted}`,
		);
		const hints = [];
		if (c.missingRequired > 0) hints.push("amber wiki --dry-run (re-scaffold missing pages)");
		if (c.staleDocs > 0) hints.push("amber maintenance stale-docs");
		if (c.controlledDrifted > 0) hints.push("amber sync");
		if (hints.length) lines.push(`  hint: ${hints.join("; ")}`);
	} else if (s.wikiDrift.note) {
		lines.push(`Wiki drift: ${s.wikiDrift.note}`);
	}
	lines.push(`Next: ${s.nextStep}`);
	return lines.join("\n");
}

module.exports = { buildStatus, renderStatus };
