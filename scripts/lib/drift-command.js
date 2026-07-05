"use strict";

// `amber drift` — CI-native drift gate. Aggregates the three existing drift
// detectors (artifact / wiki / scaffold) into one concern with CI exit
// semantics: exit 1 iff any actionable drift. Read-only; no execution; no
// auto-fix. Mirrors the Verification-layer shape of `doctor` / `manifests`.
// ponytail: single-pass aggregation — detectors already do the work; this
// just shapes their output for CI.
const { resolveTarget } = require("./core/fs-utils");
const { detectArtifactDrift } = require("./core/artifact-drift");
const { detectWikiDrift } = require("./core/wiki-drift");
const { detectScaffoldDrift } = require("./core/scaffold-version-drift");
const { classifyTarget } = require("./core/target-classification");

function safe(fallback, fn) {
	try {
		return fn();
	} catch {
		return fallback;
	}
}

function scopeArtifact(targetRoot) {
	const a = safe({ available: false, note: "detector error" }, () => detectArtifactDrift(targetRoot));
	if (!a.available) return { available: false, note: a.note };
	const driftedFeatures = (a.features || []).filter((f) => f.classification === "drifted");
	return { available: true, counts: a.counts, drifted: a.counts.drifted, driftedFeatures };
}

function scopeWiki(targetRoot) {
	const w = safe({ available: false, note: "detector error" }, () => detectWikiDrift(targetRoot));
	if (!w.available) return { available: false, note: w.note };
	const c = w.counts;
	return { available: true, counts: c, drifted: c.staleDocs + c.missingRequired };
}

function scopeScaffold(targetRoot) {
	if (classifyTarget(targetRoot).type === "product-repo") {
		return { available: false, note: "n/a (product-repo ships the templates)" };
	}
	const s = safe({ installed: false, note: "detector error" }, () => detectScaffoldDrift(targetRoot));
	if (!s.installed || !s.counts) return { available: false, note: s.note || "no install provenance" };
	return { available: true, counts: s.counts, drifted: s.counts.stale };
}

function runDrift(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const scope = options.scope || "all";
	const want = (s) => scope === "all" || scope === s;
	const scopes = {};
	if (want("artifact")) scopes.artifact = scopeArtifact(targetRoot);
	if (want("wiki")) scopes.wiki = scopeWiki(targetRoot);
	if (want("scaffold")) scopes.scaffold = scopeScaffold(targetRoot);
	const totalDrifted = Object.values(scopes).reduce((sum, s) => sum + (s.drifted || 0), 0);
	const exitCode = options.noFail ? 0 : totalDrifted > 0 ? 1 : 0;
	return { target: targetRoot, available: true, scopes, totalDrifted, exitCode };
}

function renderDrift(result, options = {}) {
	return options.format === "gh-annotations" ? renderGh(result) : renderText(result);
}

function renderText(result) {
	const lines = [`Target: ${result.target}`];
	for (const [name, s] of Object.entries(result.scopes)) {
		if (!s.available) {
			lines.push(`${name}: ${s.note}`);
			continue;
		}
		const c = s.counts;
		if (name === "artifact") lines.push(`artifact: drifted=${c.drifted} aligned=${c.aligned} skipped=${c.skipped}`);
		else if (name === "wiki") lines.push(`wiki: staleDocs=${c.staleDocs} missingRequired=${c.missingRequired} controlledDrifted=${c.controlledDrifted}`);
		else if (name === "scaffold") lines.push(`scaffold: fresh=${c.fresh} stale=${c.stale} customized=${c.customized} ambiguous=${c.ambiguous} missing=${c.missing}`);
	}
	lines.push(`Total drifted: ${result.totalDrifted}`);
	lines.push(`Exit: ${result.exitCode}`);
	return lines.join("\n");
}

function renderGh(result) {
	const lines = [];
	const art = result.scopes.artifact;
	if (art && art.available) {
		for (const f of art.driftedFeatures || []) {
			const file = (f.paths && f.paths[0]) || "feature_list.json";
			lines.push(`::warning file=${file}::feature ${f.id} drifted — code newer than last evidence (${f.lastCommitDate} > ${f.anchorDate})`);
		}
	}
	const wiki = result.scopes.wiki;
	if (wiki && wiki.available) {
		if (wiki.counts.staleDocs > 0) lines.push(`::warning::wiki drift: ${wiki.counts.staleDocs} stale doc(s)`);
		if (wiki.counts.missingRequired > 0) lines.push(`::warning::wiki drift: ${wiki.counts.missingRequired} missing required page(s)`);
	}
	const scaf = result.scopes.scaffold;
	if (scaf && scaf.available && scaf.counts.stale > 0) {
		lines.push(`::warning::scaffold drift: ${scaf.counts.stale} stale scaffold file(s) — run \`amber sync\``);
	}
	return lines.join("\n");
}

module.exports = { runDrift, renderDrift };
