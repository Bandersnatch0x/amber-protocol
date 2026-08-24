"use strict";

/**
 * Visualization Workbench projections (#164).
 *
 * Six rebuildable read-only projections over authorized canonical artifacts
 * (context pages) and governed records, covering the baseline's four named
 * projections (temporal, causal, relationship, mind-map/context) plus the
 * timeline event sequence:
 *   - temporal:  time-ordered (by createdAt)
 *   - timeline:  ordered event sequence
 *   - causal:    directional page→page derivation edges (older → newer)
 *   - relationship: page↔page edges from shared sources
 *   - mind-map:  page → source hierarchy
 *   - context:   page → source context (ref/kind/hash)
 *
 * All reads are bounded (limit), sortable by key, filterable, and
 * deterministic. Compare reports added/removed/changed between two states.
 * Projections are never canonical authority.
 */

const { sha256 } = require("./context-hash");
const { readCanonicalPages: canonicalPages } = require("./context-store");

const PROJECTION_KINDS = Object.freeze([
	"temporal",
	"timeline",
	"causal",
	"relationship",
	"mind-map",
	"context",
]);

function sortByTimestamp(items, { ascending = false } = {}) {
	// deterministic sort; items without a timestamp sink to the end and
	// compare equal to each other (never an unstable 1/-1 flip). Default is
	// newest-first (descending) to match the temporal view.
	const direction = ascending ? 1 : -1;
	return [...items].sort((a, b) => {
		const hasA = a && a.timestamp;
		const hasB = b && b.timestamp;
		if (!hasA && !hasB) return 0;
		if (!hasA) return 1;
		if (!hasB) return -1;
		return String(a.timestamp).localeCompare(String(b.timestamp)) * direction;
	});
}

function renderTemporal(targetRoot) {
	const pages = canonicalPages(targetRoot);
	const entries = sortByTimestamp(
		pages.map((page) => ({
			id: page.pageId || page.id,
			title: page.title || "",
			timestamp: page.createdAt || null,
		})),
	);
	return { kind: "temporal", entries };
}

function renderTimeline(targetRoot) {
	const pages = canonicalPages(targetRoot);
	const events = sortByTimestamp(
		pages.map((page) => ({
			id: page.pageId || page.id,
			title: page.title || "",
			timestamp: page.createdAt || null,
			eventType: "page-created",
		})),
	);
	return { kind: "timeline", events };
}

/**
 * Causal projection: directional page→page derivation edges.
 *
 * Two pages that share a source reference form a derivation chain ordered by
 * createdAt — the earlier page is treated as the causal antecedent of the
 * later one (later derives from earlier through the shared provenance).
 * Deterministic and read-only; never claims real-world causality beyond what
 * shared provenance + timestamps support.
 */
function renderCausal(targetRoot) {
	const pages = canonicalPages(targetRoot);
	const nodes = pages.map((page) => ({
		id: page.pageId || page.id,
		title: page.title || "",
		timestamp: page.createdAt || null,
	}));
	const sourceIndex = new Map();
	for (const page of pages) {
		for (const [_sourceId, source] of Object.entries(page.sources || {})) {
			const ref = source && source.ref;
			if (!ref) continue;
			if (!sourceIndex.has(ref)) sourceIndex.set(ref, []);
			sourceIndex
				.get(ref)
				.push({ pageId: page.pageId || page.id, createdAt: page.createdAt || null });
		}
	}
	const edges = [];
	for (const [ref, members] of sourceIndex) {
		// derivation chain: oldest page first (causal antecedent)
		const ordered = sortByTimestamp(
			members.map((m) => ({ ...m, timestamp: m.createdAt })),
			{ ascending: true },
		);
		for (let i = 0; i < ordered.length; i += 1) {
			for (let j = i + 1; j < ordered.length; j += 1) {
				if (ordered[i].pageId === ordered[j].pageId) continue;
				edges.push({
					source: ordered[i].pageId,
					target: ordered[j].pageId,
					ref,
					type: "causal-derivation",
				});
			}
		}
	}
	return { kind: "causal", nodes, edges };
}

function renderRelationship(targetRoot) {
	const pages = canonicalPages(targetRoot);
	const nodes = pages.map((page) => ({ id: page.pageId || page.id, title: page.title || "" }));
	const sourceIndex = new Map();
	for (const page of pages) {
		for (const [_sourceId, source] of Object.entries(page.sources || {})) {
			const ref = source && source.ref;
			if (!ref) continue;
			if (!sourceIndex.has(ref)) sourceIndex.set(ref, []);
			sourceIndex.get(ref).push(page.pageId || page.id);
		}
	}
	const links = [];
	for (const [ref, memberIds] of sourceIndex) {
		for (let i = 0; i < memberIds.length; i += 1) {
			for (let j = i + 1; j < memberIds.length; j += 1) {
				links.push({ source: memberIds[i], target: memberIds[j], ref, type: "shares-source" });
			}
		}
	}
	return { kind: "relationship", nodes, links };
}

function renderMindMap(targetRoot) {
	const pages = canonicalPages(targetRoot);
	const mindMap = {
		kind: "mind-map",
		pages: pages.map((page) => ({
			id: page.pageId || page.id,
			title: page.title || "",
			sources: Object.entries(page.sources || {}).map(([id, source]) => ({
				id,
				ref: source && source.ref,
				kind: source && source.kind,
			})),
		})),
	};
	return mindMap;
}

/**
 * Context projection: every page with its full source context
 * (ref/kind/hash). The baseline's "mind-map/context" pair: mind-map is the
 * hierarchy shape, context is the flat source-context view.
 */
function renderContext(targetRoot) {
	const pages = canonicalPages(targetRoot);
	return {
		kind: "context",
		contexts: pages.map((page) => ({
			id: page.pageId || page.id,
			title: page.title || "",
			sources: Object.entries(page.sources || {}).map(([id, source]) => ({
				id,
				ref: source && source.ref,
				kind: source && source.kind,
				hash: source && (source.rawHash || source.normHash || null),
			})),
		})),
	};
}

const RENDERERS = {
	temporal: renderTemporal,
	timeline: renderTimeline,
	causal: renderCausal,
	relationship: renderRelationship,
	"mind-map": renderMindMap,
	context: renderContext,
};

/**
 * Build a workbench projection of the requested kind.
 * @param {string} targetRoot - Repository root.
 * @param {string} kind - One of PROJECTION_KINDS.
 * @returns {object} The projection with a sourceHash.
 */
function buildWorkbenchProjection(targetRoot, kind) {
	if (!PROJECTION_KINDS.includes(kind)) {
		throw new Error(`unknown workbench projection kind "${kind}"`);
	}
	const body = RENDERERS[kind](targetRoot);
	const sourceHash = sha256(JSON.stringify(body));
	return { ...body, sourceHash };
}

/**
 * Apply bounded reads: limit, sort, filter.
 * @param {Array<object>} items - Input items.
 * @param {{limit?: number, sortKey?: string|null, filter?: object|null}} opts
 * @returns {{items: Array<object>, truncated: boolean}}
 */
function applyBounds(items, { limit = 50, sortKey = null, filter = null } = {}) {
	let result = [...items];
	if (filter && typeof filter === "object") {
		result = result.filter((item) =>
			Object.entries(filter).every(([key, value]) => item[key] === value),
		);
	}
	if (sortKey) {
		result.sort((a, b) => {
			const va = a[sortKey];
			const vb = b[sortKey];
			if (typeof va === "number" && typeof vb === "number") return va - vb;
			return String(va).localeCompare(String(vb));
		});
	}
	const truncated = result.length > limit;
	return { items: result.slice(0, limit), truncated };
}

/**
 * Compare two projection states.
 * @param {object} before - Prior state.
 * @param {object} after - Current state.
 * @returns {{changed: boolean, added: Array<object>, removed: Array<object>}}
 */
function compareProjections(before, after) {
	const beforeIds = new Set((before.nodes || []).map((n) => n.id));
	const afterIds = new Set((after.nodes || []).map((n) => n.id));
	const added = (after.nodes || []).filter((n) => !beforeIds.has(n.id));
	const removed = (before.nodes || []).filter((n) => !afterIds.has(n.id));
	return { changed: added.length > 0 || removed.length > 0, added, removed };
}

module.exports = {
	PROJECTION_KINDS,
	sha256,
	buildWorkbenchProjection,
	renderTemporal,
	renderTimeline,
	renderCausal,
	renderRelationship,
	renderMindMap,
	renderContext,
	applyBounds,
	compareProjections,
};
