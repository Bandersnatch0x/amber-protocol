"use strict";

const { listPages, readPage } = require("./context-store");

const PAGE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KNOWLEDGE_KINDS = Object.freeze([
	"invariant",
	"decision",
	"pattern",
	"failure",
	"rejected-approach",
	"external-constraint",
	"unspecified",
]);
const KNOWLEDGE_KIND_SET = new Set(KNOWLEDGE_KINDS);

function normalizeKnowledgeKind(value) {
	return typeof value === "string" && KNOWLEDGE_KIND_SET.has(value) ? value : "unspecified";
}

function normalizePageIds(value) {
	const values = value == null ? [] : Array.isArray(value) ? value : [value];
	return [...new Set(values.filter((item) => typeof item === "string" && item.length > 0))];
}

function readKnowledgeGraph(targetRoot, replacement) {
	const pages = new Map();
	for (const { pageId } of listPages(targetRoot)) {
		const page = replacement && replacement.pageId === pageId ? replacement : readPage(targetRoot, pageId);
		if (page) pages.set(pageId, page);
	}
	if (replacement && !pages.has(replacement.pageId)) pages.set(replacement.pageId, replacement);

	const successorsByPage = new Map();
	for (const page of pages.values()) {
		for (const predecessor of normalizePageIds(page.supersedes)) {
			const successors = successorsByPage.get(predecessor) || [];
			successors.push(page.pageId);
			successorsByPage.set(predecessor, successors);
		}
	}
	for (const successors of successorsByPage.values()) successors.sort();
	return { pages, successorsByPage };
}

function validateKnowledgeGraph(targetRoot, page) {
	const errors = [];
	if (page.knowledgeKind != null && !KNOWLEDGE_KIND_SET.has(page.knowledgeKind)) {
		errors.push(`invalid knowledgeKind: ${page.knowledgeKind}`);
	}
	const supersedes = normalizePageIds(page.supersedes);
	if (supersedes.length !== (Array.isArray(page.supersedes) ? page.supersedes.length : 0)) {
		errors.push("supersedes must contain unique Context Page identifiers");
	}
	for (const pageId of supersedes) {
		if (!PAGE_ID_RE.test(pageId)) errors.push(`invalid supersedes pageId: ${pageId}`);
		if (pageId === page.pageId) errors.push(`Context Page ${page.pageId} cannot supersede itself`);
	}
	if (errors.length > 0) return errors;

	const graph = readKnowledgeGraph(targetRoot, page);
	for (const pageId of supersedes) {
		if (!graph.pages.has(pageId)) errors.push(`superseded Context Page does not exist: ${pageId}`);
	}
	const visiting = new Set();
	const visited = new Set();
	function visit(pageId) {
		if (visiting.has(pageId)) return true;
		if (visited.has(pageId)) return false;
		visiting.add(pageId);
		const current = graph.pages.get(pageId);
		for (const predecessor of normalizePageIds(current && current.supersedes)) {
			if (visit(predecessor)) return true;
		}
		visiting.delete(pageId);
		visited.add(pageId);
		return false;
	}
	if (visit(page.pageId)) errors.push(`supersession cycle includes Context Page ${page.pageId}`);
	return errors;
}

function describeKnowledge(targetRoot, page) {
	const graph = readKnowledgeGraph(targetRoot);
	const supersededBy = graph.successorsByPage.get(page.pageId) || [];
	return {
		knowledgeKind: normalizeKnowledgeKind(page.knowledgeKind),
		supersedes: normalizePageIds(page.supersedes),
		supersededBy,
		lifecycle: supersededBy.length > 0 ? "superseded" : "current",
	};
}

module.exports = {
	KNOWLEDGE_KINDS,
	normalizeKnowledgeKind,
	normalizePageIds,
	readKnowledgeGraph,
	validateKnowledgeGraph,
	describeKnowledge,
};
