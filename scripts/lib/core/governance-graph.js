"use strict";

/**
 * Governance Graph projection + bounded query contract (#162).
 *
 * The Governance Graph is a rebuildable read-only projection (baseline bounded
 * context; ADR-0019 D5). It derives deterministic relationship edges from
 * canonical Amber artifacts (context pages + their source references) and
 * serves bounded queries with exact-scope denial: a query for an unknown
 * scope is denied, never guessed.
 *
 * Never canonical authority. Rebuildable from canonical inputs at any time.
 */

const { sha256 } = require("./context-hash");
const { readCanonicalPages: canonicalPages } = require("./context-store");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_QUERY_LIMIT = 50;

/**
 * Parse a scope parameter into an explicit scope id, or null for unscoped.
 * @param {string|null} scope - Raw scope string.
 * @returns {string|null}
 */
function parseScope(scope) {
	if (typeof scope !== "string" || scope.trim() === "") return null;
	return scope.trim();
}

/**
 * Build the Governance Graph from canonical artifacts.
 * @param {string} targetRoot - Repository root.
 * @returns {{nodes: Array<object>, edges: Array<object>, sourceHash: string}}
 */
function buildGovernanceGraph(targetRoot) {
	const pages = canonicalPages(targetRoot);
	const nodes = pages.map((page) => ({
		id: page.pageId || page.id,
		type: "context-page",
		title: page.title || "",
	}));
	// Edges: pages sharing a source reference → relationship with provenance.
	const sourceIndex = new Map();
	const edges = [];
	for (const page of pages) {
		const sources = page.sources || {};
		for (const [sourceId, source] of Object.entries(sources)) {
			const ref = source && source.ref;
			if (!ref) continue;
			const key = ref;
			if (!sourceIndex.has(key)) sourceIndex.set(key, []);
			sourceIndex.get(key).push({ pageId: page.pageId || page.id, sourceId, source });
		}
	}
	for (const [ref, members] of sourceIndex) {
		if (members.length < 2) continue;
		for (let i = 0; i < members.length; i += 1) {
			for (let j = i + 1; j < members.length; j += 1) {
				edges.push({
					source: members[i].pageId,
					target: members[j].pageId,
					type: "shares-source",
					ref,
					provenance: members.map((m) => ({
						pageId: m.pageId,
						sourceId: m.sourceId,
						ref: m.source && m.source.ref,
						hash: m.source && (m.source.rawHash || m.source.normHash || null),
					})),
				});
			}
		}
	}
	const canonicalJson = JSON.stringify({ nodes, edges });
	return { nodes, edges, sourceHash: sha256(canonicalJson) };
}

/**
 * Query the graph with bounded reads and exact-scope denial.
 * @param {{nodes: Array<object>, edges: Array<object>}} graph - Built graph.
 * @param {{scope?: string|null, limit?: number}} params - Query parameters.
 * @returns {{ok: boolean, code: string|null, nodes: Array<object>, truncated: boolean, reason?: string}}
 */
function queryGraph(graph, { scope = null, limit = DEFAULT_QUERY_LIMIT } = {}) {
	const parsedScope = parseScope(scope);
	const cap = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_QUERY_LIMIT;
	if (parsedScope !== null) {
		// exact-scope denial: unknown scope is denied, never guessed
		const node = graph.nodes.find((n) => n.id === parsedScope);
		if (!node) {
			return {
				ok: false,
				code: "AMBER_E_GRAPH_DENY",
				nodes: [],
				truncated: false,
				reason: `unknown scope "${parsedScope}" denied`,
			};
		}
		const relatedEdges = graph.edges.filter(
			(e) => e.source === parsedScope || e.target === parsedScope,
		);
		const relatedIds = new Set([node.id]);
		for (const edge of relatedEdges) {
			relatedIds.add(edge.source);
			relatedIds.add(edge.target);
		}
		const nodes = graph.nodes.filter((n) => relatedIds.has(n.id));
		return { ok: true, code: null, nodes, truncated: false, reason: null };
	}
	// unscoped: bounded read with truncation flag
	const nodes = graph.nodes.slice(0, cap);
	return { ok: true, code: null, nodes, truncated: graph.nodes.length > cap, reason: null };
}

module.exports = {
	DEFAULT_QUERY_LIMIT,
	sha256,
	parseScope,
	buildGovernanceGraph,
	queryGraph,
};
