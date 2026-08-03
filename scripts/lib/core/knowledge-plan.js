"use strict";

/**
 * Knowledge Plan compatibility module (legacy CommonJS surface).
 *
 * F013-K1 moved read-only load/validate/report into scripts/lib/knowledge-plan/.
 * This file remains the documented require path for package consumers and for
 * write-capable helpers (scaffold / materialize / propose) during the expand
 * step. Prefer the root facade (`scripts/lib/knowledge-plan`) for new call sites.
 *
 * Deprecated helper exports (loadKnowledgePlan, buildKnowledgeReport, etc.) are
 * forwarded without runtime deprecation noise for one major cycle.
 */

const fs = require("node:fs");
const path = require("node:path");

// Minimal YAML loader/escaper for plan files lives in ./simple-yaml (extracted
// so YAML mechanics stay out of plan/knowledge-base domain logic). Re-exported
// below for existing direct importers.
const { parseSimpleYaml, escapeYaml } = require("./simple-yaml");

const {
	TEMPLATE_ROOT,
} = require("./constants");

const {
	pathExists,
	readJson,
	relativeSlash,
	resolveTarget,
} = require("./fs-utils");

const { listTemplateFiles, copyTemplateFiles } = require("./scaffold");

// Read-path implementation lives in the deep Knowledge Plan module (F013-K1).
const {
	KNOWLEDGE_PLAN_RELATIVE,
	KNOWLEDGE_PLAN_YAML_RELATIVE,
	loadKnowledgePlan,
} = require("../knowledge-plan/internal/load");
const { validateKnowledgePlanData } = require("../knowledge-plan/internal/validate");
const {
	buildKnowledgeReport,
	formatKnowledgeReportText,
} = require("../knowledge-plan/internal/report");

/**
 * Scaffold the Knowledge Plan (JSON by default, or yaml if requested).
 */
function scaffoldKnowledgePlan(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const useYaml = Boolean(options.yaml || options.yml);

	const wikiTemplateRoot = path.join(TEMPLATE_ROOT, "docs", "wiki");
	const all = listTemplateFiles(wikiTemplateRoot);

	const templateName = useYaml ? "knowledge-plan.yaml" : "knowledge-plan.json";
	const planItem = all.find((item) => item.relativePath === templateName);

	if (!planItem) {
		return {
			target: targetRoot,
			created: [],
			skipped: [],
			errors: [`${templateName} template not found in templates/docs/wiki/`],
			warnings: [],
		};
	}

	const destRel = useYaml ? KNOWLEDGE_PLAN_YAML_RELATIVE : KNOWLEDGE_PLAN_RELATIVE;

	const items = [{ source: planItem.source, relativePath: destRel }];

	const result = copyTemplateFiles(targetRoot, items, options);

	let validation = { errors: [], warnings: [] };
	if (!options.dryRun) {
		const loaded = loadKnowledgePlan(targetRoot);
		validation.errors = loaded.errors;
		validation.warnings = loaded.warnings;
	}

	return {
		target: targetRoot,
		created: result.created,
		skipped: result.skipped,
		errors: validation.errors,
		warnings: validation.warnings,
	};
}

/**
 * Slugify a title into a directory / filename friendly name.
 */
function slugifyCategory(title) {
	return (title || "unknown")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

/**
 * Materialize a repo-knowledge style tree under docs/wiki/knowledge/ based on the plan.
 * This replicates a structured category-based knowledge output (category folders + rich pages),
 * but as Amber-governed static artifacts (no LLM here; seeds content from plan).
 *
 * Each document in the plan becomes a category page.
 * Global notes are injected as grounding context.
 */
function materializeKnowledgeBase(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const loaded = loadKnowledgePlan(targetRoot);
	const dryRun = Boolean(options.dryRun);

	if (!loaded.found || !loaded.plan) {
		return {
			target: targetRoot,
			created: [],
			skipped: [],
			errors: ["No valid knowledge plan found. Run `amber wiki knowledge plan` first."],
			warnings: [],
		};
	}

	const plan = loaded.plan;
	const notes = (plan.knowledgePlan && plan.knowledgePlan.notes) || [];
	const documents = (plan.knowledgePlan && plan.knowledgePlan.documents) || [];
	const knowledgeCards = plan.knowledgeCards || plan.knowledgecard || [];

	const knowledgeRoot = path.join(targetRoot, "docs", "wiki", "knowledge");
	const created = [];
	const skipped = [];
	const errors = [];

	function ensureDir(p) {
		if (!dryRun) fs.mkdirSync(p, { recursive: true });
	}

	ensureDir(knowledgeRoot);

	// Write an index for the knowledge base
	const indexPath = path.join(knowledgeRoot, "index.md");
	const indexContent = buildKnowledgeIndex(plan, documents, knowledgeCards);
	if (pathExists(indexPath)) {
		skipped.push(relativeSlash(targetRoot, indexPath));
	} else {
		created.push(relativeSlash(targetRoot, indexPath));
		if (!dryRun) fs.writeFileSync(indexPath, indexContent, "utf8");
	}

	// Create one page per declared document (category)
	for (const doc of documents) {
		const slug = slugifyCategory(doc.title);
		const dir = path.join(knowledgeRoot, slug);
		ensureDir(dir);

		const filePath = path.join(dir, `${slug}.md`);
		const rel = relativeSlash(targetRoot, filePath);

		if (pathExists(filePath)) {
			skipped.push(rel);
			continue;
		}

		const page = buildKnowledgePage(doc, notes, plan);
		created.push(rel);
		if (!dryRun) {
			fs.writeFileSync(filePath, page, "utf8");
		}
	}

	// Also materialize a concise knowledge-cards page (top level)
	const cardsPath = path.join(knowledgeRoot, "knowledge-cards.md");
	if (pathExists(cardsPath)) {
		skipped.push(relativeSlash(targetRoot, cardsPath));
	} else if (knowledgeCards.length > 0) {
		const cardsMd = buildKnowledgeCardsPage(knowledgeCards, notes);
		created.push(relativeSlash(targetRoot, cardsPath));
		if (!dryRun) fs.writeFileSync(cardsPath, cardsMd, "utf8");
	}

	return {
		target: targetRoot,
		created,
		skipped,
		errors,
		warnings: [],
		knowledgeRoot: relativeSlash(targetRoot, knowledgeRoot),
	};
}

function buildKnowledgeIndex(plan, documents, cards) {
	const lines = [];
	lines.push("---");
	lines.push('layout_version: "amber/v1"');
	lines.push('kind: "knowledge"');
	lines.push(`generated_by: "amber wiki knowledge"`);
	lines.push("---");
	lines.push("");
	lines.push("# Repository Knowledge");
	lines.push("");
	lines.push("This knowledge base is derived from the declarative knowledge plan.");
	lines.push("");

	if (plan.knowledgePlan && plan.knowledgePlan.notes && plan.knowledgePlan.notes.length) {
		lines.push("## Grounding Notes");
		for (const n of plan.knowledgePlan.notes) {
			lines.push(`- ${n.text}`);
		}
		lines.push("");
	}

	lines.push("## Categories");
	lines.push("");
	lines.push("| Category | Goal |");
	lines.push("| --- | --- |");
	for (const d of documents) {
		const slug = slugifyCategory(d.title);
		lines.push(`| [${d.title}](./${slug}/${slug}.md) | ${d.goal || ""} |`);
	}
	lines.push("");

	if (cards && cards.length) {
		lines.push(`## Knowledge Cards`);
		lines.push("");
		lines.push(`See [knowledge-cards.md](./knowledge-cards.md) for ${cards.length} concise facts.`);
	}

	return lines.join("\n") + "\n";
}

function buildKnowledgePage(doc, notes, plan) {
	const lines = [];
	const effectiveTemplate = doc.template || (plan.knowledgePlan && plan.knowledgePlan.template) || "architecture";

	lines.push("---");
	lines.push(`kind: "knowledge"`);
	lines.push(`category: "${slugifyCategory(doc.title)}"`);
	lines.push(`title: "${doc.title}"`);
	lines.push(`template: "${effectiveTemplate}"`);
	lines.push(`updated_at: "${new Date().toISOString()}"`);
	lines.push("---");
	lines.push("");
	lines.push(`# ${doc.title}`);
	lines.push("");
	if (doc.goal) {
		lines.push(doc.goal);
		lines.push("");
	}

	if (doc.hints) {
		lines.push("## Analysis Focus (from plan)");
		lines.push(doc.hints);
		lines.push("");
	}

	if (notes && notes.length) {
		lines.push("## Grounding Notes (from knowledge plan)");
		for (const n of notes) {
			const author = n.author ? ` [${n.author}]` : "";
			lines.push(`- ${n.text}${author}`);
		}
		lines.push("");
	}

	// Use richer skeleton for architecture preset
	// The original capability also involves Mermaid diagram support (we include placeholders).
	if (effectiveTemplate === "architecture" || !effectiveTemplate) {
		lines.push("## What system/approach is used");
		lines.push("");
		lines.push("- ");
		lines.push("");
		lines.push("## Key files / modules / packages");
		lines.push("");
		lines.push("- ");
		lines.push("");
		lines.push("## Architecture and conventions");
		lines.push("");
		lines.push("- ");
		lines.push("");
		lines.push("## Diagrams");
		lines.push("");
		lines.push("```mermaid");
		lines.push("%% Suggested: system map, data flow, module boundaries, etc.");
		lines.push("graph TD");
		lines.push("    A[Entry] --> B[Core]");
		lines.push("```");
		lines.push("");
		lines.push("*(Mermaid diagrams are supported in the generated knowledge; the original implementation had dedicated fix tooling.)*");
		lines.push("");
		lines.push("## Rules developers should follow");
		lines.push("");
		lines.push("- ");
	} else {
		lines.push("## What this area covers");
		lines.push("");
		lines.push("- ");
		lines.push("");
		lines.push("## Key files / modules");
		lines.push("");
		lines.push("- ");
		lines.push("");
		lines.push("## Architecture and conventions");
		lines.push("");
		lines.push("- ");
		lines.push("");
		lines.push("## Rules and invariants");
		lines.push("");
		lines.push("- ");
	}

	lines.push("");
	lines.push("## Unknowns / Needs Confirmation");
	lines.push("");
	lines.push("- ");
	lines.push("");

	return lines.join("\n");
}

function buildKnowledgeCardsPage(cards, notes) {
	const lines = [];
	lines.push("---");
	lines.push('kind: "knowledge_cards"');
	lines.push("---");
	lines.push("");
	lines.push("# Knowledge Cards");
	lines.push("");
	lines.push("Concise, high-signal facts for rapid orientation.");
	lines.push("");

	for (const c of cards) {
		const id = c.id ? `**${c.id}** — ` : "";
		const tags = c.tags && c.tags.length ? ` _(${c.tags.join(", ")})_` : "";
		lines.push(`- ${id}${c.text}${tags}`);
	}

	if (notes && notes.length) {
		lines.push("");
		lines.push("## Derived from these grounding notes");
		for (const n of notes) lines.push(`- ${n.text}`);
	}

	return lines.join("\n") + "\n";
}

/**
 * Pre-flight inspection + plan proposal.
 * Inspects the project using native means (no special wiki tools), then produces
 * a suggested knowledge plan (or updates an existing one in dry-run mode).
 */
function proposeKnowledgePlan(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const dryRun = Boolean(options.dryRun);
	const force = Boolean(options.force);

	const existing = loadKnowledgePlan(targetRoot);

	// Basic native inspection of the project structure and key files.
	const inspection = performNativeInspection(targetRoot);

	// Start from existing plan if present and not forcing, otherwise from template defaults
	let basePlan = existing.found && existing.plan ? { ...existing.plan } : getDefaultKnowledgePlanSkeleton();

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
	KNOWLEDGE_PLAN_RELATIVE,
	KNOWLEDGE_PLAN_YAML_RELATIVE,
	scaffoldKnowledgePlan,
	loadKnowledgePlan,
	validateKnowledgePlanData,
	buildKnowledgeReport,
	formatKnowledgeReportText,
	materializeKnowledgeBase,
	proposeKnowledgePlan,
	parseSimpleYaml,
	planToSimpleYaml,
};
