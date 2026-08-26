"use strict";

/**
 * Governance Graph projection + bounded query contract (#162; F049 ticket
 * 05, #222).
 *
 * The Governance Graph is a rebuildable read-only projection (baseline
 * bounded context; ADR-0019 D5) and — per ADR-0021 — the ONLY graph
 * projection. It derives deterministic relationship edges from canonical
 * Amber artifacts (context pages + their source references) and, since F049
 * ticket 05, from committed Canonical Planning Artifact revisions: every
 * fully committed Intent/Spec/Plan revision becomes a graph node and every
 * resolved Trace (refines / realizes / supersedes) becomes a typed edge, so
 * a graph consumer can query the Intent → Spec → Plan lineage.
 *
 * Never canonical authority. Rebuildable from canonical inputs at any time.
 * The artifact layer is derived through the strictly read-only verification
 * seam listArtifactRevisions (canonical-artifacts.js), so a corrupt store
 * fails the graph build closed instead of yielding a partial projection
 * (F035-S5: corrupt revisions are excluded by refusal, never skipped), and
 * no code path from a graph build or query reaches a Canonical Artifact
 * write. Deterministic: nodes and edges are canonically ordered, so
 * identical canonical state always produces the identical graph and source
 * hash, independent of directory iteration order — and, since the checkpoint
 * canonicalizes key order, independent of raw `sources` key order inside the
 * page files too (ticket-05 review finding F-2): edge order is a total order
 * (source, target, type, then the shared `ref`), so canonically identical
 * page stores cannot differ in graph hash.
 */

const { sha256, canonicalJson } = require("./context-hash");
const { readCanonicalPages: canonicalPages } = require("./context-store");
const { listArtifactRevisions } = require("./canonical-artifacts");
const { artifactGraphLayer, artifactSourceFingerprint } = require("./artifact-graph-projection");

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
 * Source state of the Governance Graph projection: canonical context pages
 * plus every committed Canonical Artifact revision (F049 ticket 05, #222).
 * Both halves are read through fail-closed canonical readers, so a corrupt
 * page set or artifact store throws instead of feeding the projection a
 * partial source.
 * @param {string} targetRoot - Repository root.
 * @returns {{artifacts: Array<object>, artifactRevisions: Array<object>}}
 */
function governanceGraphSource(targetRoot) {
	return {
		artifacts: canonicalPages(targetRoot),
		artifactRevisions: listArtifactRevisions(targetRoot),
	};
}

/**
 * Source checkpoint of the Governance Graph projection: a tamper-evident
 * digest of BOTH canonical sources. The page half is the canonical page
 * set; the artifact half is the committed revision references with their
 * Envelope hashes (an Envelope hash covers the full revision content —
 * bodyHash, provenance, lifecycle, scope, resolved traces), so the
 * checkpoint changes exactly when either source changes. A rebuild records
 * this checkpoint in its receipt; a status check compares against it.
 * @param {{artifacts: Array<object>, artifactRevisions: Array<object>}} source
 * @returns {string} `sha256:<64 hex>`
 */
function governanceGraphCheckpoint({ artifacts = [], artifactRevisions = [] } = {}) {
	return sha256(
		canonicalJson(
			JSON.stringify({
				artifacts,
				artifactRevisions: artifactSourceFingerprint(artifactRevisions),
			}),
		),
	);
}

// Page nodes: one per canonical context page.
function pageNodes(pages) {
	return pages.map((page) => ({
		id: page.pageId || page.id,
		type: "context-page",
		title: page.title || "",
	}));
}

// Page edges: pages sharing a source reference → relationship with
// provenance. Members are ordered by (page id, source id) and refs are
// emitted in sorted order, so the edge set (and its hash) is a pure function
// of the page content — never of directory order or of raw `sources` key
// order inside a page file (F-2: the checkpoint canonicalizes key order, so
// the graph output must not depend on it either).
function pageEdges(pages) {
	const sourceIndex = new Map();
	const edges = [];
	for (const page of pages) {
		const sources = page.sources || {};
		for (const [sourceId, source] of Object.entries(sources)) {
			const ref = source && source.ref;
			if (!ref) continue;
			if (!sourceIndex.has(ref)) sourceIndex.set(ref, []);
			sourceIndex.get(ref).push({ pageId: page.pageId || page.id, sourceId, source });
		}
	}
	// Canonical emission: refs in sorted order, members by (page id, source
	// id) — a page carrying the same ref under two source ids, or two pages
	// sharing two refs, always yields the same members array and edge order.
	const refs = [...sourceIndex.keys()].sort();
	for (const ref of refs) {
		const members = sourceIndex.get(ref);
		if (members.length < 2) continue;
		members.sort((a, b) => {
			if (a.pageId !== b.pageId) return a.pageId < b.pageId ? -1 : 1;
			if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
			return 0;
		});
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
	return edges;
}

function compareNodes(a, b) {
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Total order over the merged edge list: (source, target, type), then — for
// page edges that share all three (two pages sharing two refs) — the shared
// `ref` as the canonical tiebreaker (F-2). Trace edges carry no `ref`, so
// the tiebreak is a no-op there; without it, order-tied page edges kept
// Map-insertion order and canonically identical stores hashed differently.
function compareEdges(a, b) {
	if (a.source !== b.source) return a.source < b.source ? -1 : 1;
	if (a.target !== b.target) return a.target < b.target ? -1 : 1;
	if (a.type !== b.type) return a.type < b.type ? -1 : 1;
	const refA = typeof a.ref === "string" ? a.ref : "";
	const refB = typeof b.ref === "string" ? b.ref : "";
	if (refA !== refB) return refA < refB ? -1 : 1;
	return 0;
}

/**
 * Build the Governance Graph from a source state (pages + committed
 * artifact revisions). Deterministic: the page nodes/edges and the artifact
 * revision nodes/typed trace edges are merged and canonically ordered, so
 * identical canonical state always yields the identical graph and source
 * hash. Page node ids and artifact revision node ids (`<type>/<identity>@
 * <revision>`) live in disjoint id namespaces by construction.
 * @param {{artifacts?: Array<object>, artifactRevisions?: Array<object>}} state
 * @returns {{nodes: Array<object>, edges: Array<object>, sourceHash: string}}
 */
function governanceGraphFromState({ artifacts = [], artifactRevisions = [] } = {}) {
	const layer = artifactGraphLayer(artifactRevisions);
	const nodes = [...pageNodes(artifacts), ...layer.nodes].sort(compareNodes);
	const edges = [...pageEdges(artifacts), ...layer.edges].sort(compareEdges);
	const canonicalGraphJson = JSON.stringify({ nodes, edges });
	return { nodes, edges, sourceHash: sha256(canonicalGraphJson) };
}

/**
 * Build the Governance Graph from canonical artifacts (context pages plus
 * committed Canonical Artifact revisions). Fail-closed: a corrupt artifact
 * store throws the typed artifact corruption error instead of producing a
 * partial graph.
 * @param {string} targetRoot - Repository root.
 * @returns {{nodes: Array<object>, edges: Array<object>, sourceHash: string}}
 */
function buildGovernanceGraph(targetRoot) {
	return governanceGraphFromState(governanceGraphSource(targetRoot));
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
	governanceGraphSource,
	governanceGraphCheckpoint,
	governanceGraphFromState,
	buildGovernanceGraph,
	queryGraph,
};
