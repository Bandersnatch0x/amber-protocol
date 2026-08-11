"use strict";

const path = require("node:path");

const { pathExists, relativeSlash, resolveTarget, walkFiles } = require("../../core/fs-utils");
const { KNOWLEDGE_PLAN_RELATIVE, loadKnowledgePlan } = require("./load");

/**
 * Simple coverage heuristic: does a wiki document with a similar title exist?
 * We check both docs/wiki/*.md and docs/architecture/*.md (case-insensitive contains).
 */
function computeDocumentCoverage(targetRoot, documents = []) {
	const wikiRoot = path.join(targetRoot, "docs", "wiki");
	const archRoot = path.join(targetRoot, "docs", "architecture");

	const existingFiles = [];
	if (pathExists(wikiRoot)) {
		walkFiles(wikiRoot)
			.filter((p) => p.toLowerCase().endsWith(".md"))
			.forEach((p) => existingFiles.push(relativeSlash(targetRoot, p)));
	}
	if (pathExists(archRoot)) {
		walkFiles(archRoot)
			.filter((p) => p.toLowerCase().endsWith(".md"))
			.forEach((p) => existingFiles.push(relativeSlash(targetRoot, p)));
	}

	const coverage = documents.map((doc) => {
		const titleLower = (doc.title || "").toLowerCase();
		const goalLower = (doc.goal || "").toLowerCase();
		const matched = existingFiles.find((rel) => {
			const base = path.basename(rel, ".md").toLowerCase().replace(/[-_]/g, " ");
			return base.includes(titleLower) || titleLower.includes(base) || goalLower.includes(base);
		});
		return {
			title: doc.title,
			goal: doc.goal,
			parent: doc.parent || "",
			hints: doc.hints || "",
			suggestedPath: doc.path || `docs/wiki/${titleToSlug(doc.title)}.md`,
			exists: Boolean(matched),
			matchedFile: matched || null,
		};
	});

	const present = coverage.filter((c) => c.exists).length;
	const total = coverage.length;

	return {
		total,
		present,
		missing: total - present,
		items: coverage,
	};
}

function titleToSlug(title) {
	return (title || "document")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Build a read-only Knowledge Plan report for the target.
 * Includes the plan (if present), notes, declared documents, knowledge cards,
 * and basic coverage against existing wiki/architecture content.
 */
function buildKnowledgeReport(target) {
	const targetRoot = resolveTarget(target);
	const loaded = loadKnowledgePlan(targetRoot);

	const report = {
		target: targetRoot,
		planFound: loaded.found,
		planPath: loaded.found ? KNOWLEDGE_PLAN_RELATIVE : null,
		errors: [...loaded.errors],
		warnings: [...loaded.warnings],
		plan: null,
		knowledgeCards: [],
		coverage: null,
		summary: "",
	};

	if (!loaded.found || !loaded.plan) {
		report.summary =
			"No knowledge-plan.json found. Run `amber wiki knowledge plan --target .` to create one.";
		return report;
	}

	const plan = loaded.plan;
	report.plan = {
		template: plan.knowledgePlan?.template || "architecture",
		notes: Array.isArray(plan.knowledgePlan?.notes)
			? plan.knowledgePlan.notes.map((n) => n.text)
			: [],
		documents: Array.isArray(plan.knowledgePlan?.documents) ? plan.knowledgePlan.documents : [],
	};

	report.knowledgeCards = Array.isArray(plan.knowledgeCards)
		? plan.knowledgeCards.map((c) => ({
				id: c.id || null,
				text: c.text,
				tags: Array.isArray(c.tags) ? c.tags : [],
			}))
		: [];

	report.coverage = computeDocumentCoverage(targetRoot, report.plan?.documents || []);

	const cov = report.coverage;
	report.summary =
		`Knowledge Plan v${plan.version || 1} (${report.plan.template}). ` +
		`${cov.present}/${cov.total} declared documents appear to have coverage in docs/wiki or docs/architecture. ` +
		`${report.knowledgeCards.length} knowledge cards defined.`;

	return report;
}

/**
 * Format a human-readable text report (used when not --json).
 */
function formatKnowledgeReportText(report) {
	const lines = [];
	lines.push(`Knowledge Plan Report — ${report.target}`);
	lines.push("");

	if (!report.planFound) {
		lines.push("No knowledge-plan.json present.");
		lines.push("Run: amber wiki knowledge plan --target .");
		return lines.join("\n");
	}

	lines.push(`Plan: ${report.planPath}`);
	lines.push(`Template: ${report.plan?.template || "default"}`);
	lines.push(`Summary: ${report.summary}`);
	lines.push("");

	if (report.errors.length > 0) {
		lines.push("Errors:");
		for (const e of report.errors) lines.push(`  - ${e}`);
		lines.push("");
	}

	lines.push("Knowledge Plan Notes (high-signal understanding):");
	if (!report.plan?.notes || report.plan.notes.length === 0) {
		lines.push("  (none)");
	} else {
		for (const note of report.plan.notes) {
			lines.push(`  • ${note}`);
		}
	}
	lines.push("");

	lines.push("Declared Documents:");
	for (const item of report.coverage.items) {
		const status = item.exists ? "[present]" : "[missing]";
		lines.push(`  ${status} ${item.title}`);
		if (item.matchedFile) {
			lines.push(`           matched: ${item.matchedFile}`);
		} else {
			lines.push(`           suggested: ${item.suggestedPath}`);
		}
		if (item.goal) {
			lines.push(`           goal: ${item.goal}`);
		}
	}
	lines.push("");

	lines.push("Knowledge Cards:");
	if (report.knowledgeCards.length === 0) {
		lines.push("  (none)");
	} else {
		for (const card of report.knowledgeCards) {
			const tagStr = card.tags && card.tags.length ? ` [${card.tags.join(", ")}]` : "";
			lines.push(`  - ${card.id ? card.id + ": " : ""}${card.text}${tagStr}`);
		}
	}

	return lines.join("\n");
}

module.exports = {
	computeDocumentCoverage,
	titleToSlug,
	buildKnowledgeReport,
	formatKnowledgeReportText,
};
