"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { escapeYaml } = require("../../core/simple-yaml");
const {
	pathExists,
	readJson,
	relativeSlash,
	resolveTarget,
} = require("../../core/fs-utils");
const {
	KNOWLEDGE_PLAN_YAML_RELATIVE,
	loadKnowledgePlan,
} = require("./load");

/**
 * Pre-flight inspection + plan proposal.
 * Inspects the project using native means (no special wiki tools), then produces
 * a suggested knowledge plan (or updates an existing one in dry-run mode).
 *
 * @param {string} target
 * @param {{ dryRun?: boolean, force?: boolean }} [options]
 * @returns {object}
 */
function proposeKnowledgePlan(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const dryRun = Boolean(options.dryRun);
	const force = Boolean(options.force);

	const existing = loadKnowledgePlan(targetRoot);

	// Basic native inspection of the project structure and key files.
	const inspection = performNativeInspection(targetRoot);

	// Start from existing plan if present and not forcing, otherwise from template defaults
	const basePlan = existing.found && existing.plan ? { ...existing.plan } : getDefaultKnowledgePlanSkeleton();

	// Merge smart suggestions
	const suggested = mergeInspectionIntoPlan(basePlan, inspection, targetRoot);

	const planPath = path.join(targetRoot, KNOWLEDGE_PLAN_YAML_RELATIVE); // prefer yaml for human editing
	const relPath = relativeSlash(targetRoot, planPath);

	const result = {
		target: targetRoot,
		planPath: relPath,
		existing: existing.found,
		inspectionSummary: inspection.summary,
		suggestedPlan: suggested,
		wouldWrite: !dryRun && (!existing.found || force),
		created: [],
		skipped: [],
		errors: [],
	};

	if (!dryRun && (!existing.found || force)) {
		try {
			const yamlText = planToSimpleYaml(suggested);
			fs.mkdirSync(path.dirname(planPath), { recursive: true });
			fs.writeFileSync(planPath, yamlText, "utf8");
			result.created.push(relPath);
		} catch (e) {
			result.errors.push(`Failed to write plan: ${e.message}`);
		}
	} else if (existing.found && !force) {
		result.skipped.push(relPath);
	}

	return result;
}

function performNativeInspection(targetRoot) {
	const summary = [];
	const topLevel = [];

	try {
		const entries = fs.readdirSync(targetRoot, { withFileTypes: true });
		for (const e of entries) {
			if (e.name.startsWith(".") || ["node_modules", "coverage", "dist", "build"].includes(e.name)) continue;
			if (e.isDirectory()) topLevel.push(e.name);
		}
	} catch (err) { void err; }

	summary.push(`Top-level directories (filtered): ${topLevel.slice(0, 12).join(", ")}${topLevel.length > 12 ? " ..." : ""}`);

	let pkg = null;
	const pkgPath = path.join(targetRoot, "package.json");
	if (pathExists(pkgPath)) {
		try {
			pkg = readJson(pkgPath);
			summary.push(`package.json: name=${pkg.name || "?"}, type=${pkg.type || "commonjs"}`);
		} catch (err) { void err; }
	}

	const hasScriptsLibCore = pathExists(path.join(targetRoot, "scripts", "lib", "core"));
	const hasSkills = pathExists(path.join(targetRoot, "skills"));
	const hasDocsWiki = pathExists(path.join(targetRoot, "docs", "wiki"));
	const hasArchitecture = pathExists(path.join(targetRoot, "docs", "architecture"));
	const hasAppsWeb = pathExists(path.join(targetRoot, "apps", "web"));
	const externalIgnore = pathExists(path.join(targetRoot, ".amberignore")) || pathExists(path.join(targetRoot, "ignore"));

	if (hasScriptsLibCore) summary.push("Detected core engine at scripts/lib/core/");
	if (hasSkills) summary.push("Detected skills/ (SKILL.md source of truth pattern)");
	if (hasDocsWiki) summary.push("Detected existing docs/wiki/");
	if (hasArchitecture) summary.push("Detected docs/architecture/");
	if (hasAppsWeb) summary.push("Detected apps/web/ (likely separate UI package)");
	if (externalIgnore) summary.push("Found external ignore file(s) (may affect scope)");

	return {
		topLevelDirs: topLevel,
		packageJson: pkg,
		hasScriptsLibCore,
		hasSkills,
		hasDocsWiki,
		hasArchitecture,
		hasAppsWeb,
		summary: summary.join(" | "),
	};
}

function getDefaultKnowledgePlanSkeleton() {
	return {
		schemaVersion: "1.0.0",
		version: 1,
		scope: { include: [], exclude: ["node_modules/**", "coverage/**", ".tmp/**", "dist/**"] },
		knowledgePlan: {
			template: "architecture",
			notes: [],
			documents: [],
		},
		knowledgeCards: [],
	};
}

function mergeInspectionIntoPlan(base, inspection, _targetRoot) {
	const plan = structuredClone(base); // deep clone

	if (!plan.knowledgePlan) plan.knowledgePlan = { template: "architecture", notes: [], documents: [] };
	if (!plan.knowledgeCards) plan.knowledgeCards = [];

	// Seed some high-value documents if the plan is nearly empty
	if (plan.knowledgePlan.documents.length < 3) {
		const commonDocs = [
			{ title: "Project Structure & Module Boundaries", goal: "Map top-level directories, ownership, and cross-cutting concerns.", hints: "Focus on scripts/, src/, apps/, templates/, schemas/, skills/." },
			{ title: "Core Engine", goal: "Describe the main business logic location and its responsibilities.", hints: "scripts/lib/core/ is usually the heart." },
			{ title: "CLI Surface vs Core", goal: "Explain how thin command handlers delegate to the core engine.", hints: "Look at *-commands.js and command-dispatcher.js." },
		];
		for (const d of commonDocs) {
			if (!plan.knowledgePlan.documents.some((x) => x.title === d.title)) {
				plan.knowledgePlan.documents.push(d);
			}
		}
	}

	// Add a useful note if none exist
	if (plan.knowledgePlan.notes.length === 0 && inspection.packageJson) {
		plan.knowledgePlan.notes.push({
			text: `${inspection.packageJson.name || "This project"} is a ${inspection.packageJson.description || "software project"}. Primary language/runtime hints from package.json: ${inspection.packageJson.type || "commonjs"}.`,
		});
	}

	return plan;
}

// Very small pretty-printer for the plan as YAML (human readable, not full yaml lib)
function planToSimpleYaml(plan) {
	const lines = [];
	lines.push("# Amber Knowledge Plan (generated / proposed)");
	lines.push(`schemaVersion: "1.0.0"`);
	lines.push(`version: ${plan.version || 1}`);
	lines.push("");
	lines.push("scope:");
	lines.push("  include: []");
	const ex = (plan.scope && plan.scope.exclude) || [];
	if (ex.length === 0) {
		lines.push("  exclude: []");
	} else {
		lines.push("  exclude:");
		for (const e of ex) lines.push(`    - "${e}"`);
	}

	lines.push("");
	lines.push("knowledgePlan:");
	lines.push(`  template: "${plan.knowledgePlan?.template || "architecture"}"`);
	const nts = plan.knowledgePlan?.notes || [];
	if (nts.length === 0) {
		lines.push("  notes: []");
	} else {
		lines.push("  notes:");
		for (const n of nts) {
			lines.push(`    - text: "${escapeYaml(n.text)}"`);
		}
	}
	const docs = plan.knowledgePlan?.documents || [];
	if (docs.length === 0) {
		lines.push("  documents: []");
	} else {
		lines.push("  documents:");
		for (const d of docs) {
			lines.push(`    - title: "${escapeYaml(d.title)}"`);
			lines.push(`      goal: "${escapeYaml(d.goal)}"`);
			if (d.hints) lines.push(`      hints: "${escapeYaml(d.hints)}"`);
			if (d.parent) lines.push(`      parent: "${d.parent}"`);
		}
	}

	lines.push("");
	const cards = plan.knowledgeCards || [];
	if (cards.length === 0) {
		lines.push("knowledgeCards: []");
	} else {
		lines.push("knowledgeCards:");
		for (const c of cards) {
			lines.push(`  - id: "${escapeYaml(c.id || "")}"`);
			lines.push(`    text: "${escapeYaml(c.text || "")}"`);
			const tags = Array.isArray(c.tags) ? c.tags : [];
			if (tags.length === 0) {
				lines.push(`    tags: []`);
			} else {
				lines.push(`    tags:`);
				for (const t of tags) {
					lines.push(`      - "${escapeYaml(t)}"`);
				}
			}
		}
	}

	return lines.join("\n") + "\n";
}

module.exports = {
	proposeKnowledgePlan,
	planToSimpleYaml,
	// Helpers kept for focused unit/characterization reuse
	performNativeInspection,
	getDefaultKnowledgePlanSkeleton,
	mergeInspectionIntoPlan,
};
