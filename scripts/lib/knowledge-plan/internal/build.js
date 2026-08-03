"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	pathExists,
	relativeSlash,
	resolveTarget,
} = require("../../core/fs-utils");
const { loadKnowledgePlan } = require("./load");

/**
 * Slugify a title into a directory / filename friendly name.
 * @param {string} title
 * @returns {string}
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
 *
 * @param {string} target
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{
 *   target: string,
 *   created: string[],
 *   skipped: string[],
 *   errors: string[],
 *   warnings: string[],
 *   knowledgeRoot?: string,
 * }}
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

module.exports = {
	materializeKnowledgeBase,
	// Exported for unit tests that may want page helpers without re-implementing.
	slugifyCategory,
	buildKnowledgeIndex,
	buildKnowledgePage,
	buildKnowledgeCardsPage,
};
