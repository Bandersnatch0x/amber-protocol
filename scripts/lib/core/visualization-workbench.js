"use strict";

/**
 * Visualization Workbench projections (#164).
 *
 * Four rebuildable read-only projections over authorized canonical artifacts
 * (context pages) and governed records:
 *   - temporal:  time-ordered (by createdAt)
 *   - timeline:  ordered event sequence
 *   - relationship: page↔page edges from shared sources
 *   - mind-map:  page → source hierarchy
 *
 * All reads are bounded (limit), sortable by key, filterable, and
 * deterministic. Compare reports added/removed/changed between two states.
 * Projections are never canonical authority.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PROJECTION_KINDS = Object.freeze(["temporal", "timeline", "relationship", "mind-map"]);

function sha256(input) {
	return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function canonicalPages(targetRoot) {
	const pagesDir = path.join(targetRoot, ".amber", "context", "pages");
	const pages = [];
	if (fs.existsSync(pagesDir)) {
		for (const name of fs
			.readdirSync(pagesDir)
			.filter((f) => f.endsWith(".json"))
			.sort()) {
			try {
				pages.push(JSON.parse(fs.readFileSync(path.join(pagesDir, name), "utf8")));
			} catch {
				// unreadable pages are not canonical evidence
			}
		}
	}
	return pages;
}

function renderTemporal(targetRoot) {
	const pages = canonicalPages(targetRoot);
	const entries = pages
		.map((page) => ({
			id: page.pageId || page.id,
			title: page.title || "",
			timestamp: page.createdAt || null,
		}))
		.sort((a, b) => {
			if (!a.timestamp) return 1;
			if (!b.timestamp) return -1;
			return String(b.timestamp).localeCompare(String(a.timestamp));
		});
	return { kind: "temporal", entries };
}

function renderTimeline(targetRoot) {
	const pages = canonicalPages(targetRoot);
	const events = pages
		.map((page) => ({
			id: page.pageId || page.id,
			title: page.title || "",
			timestamp: page.createdAt || null,
			eventType: "page-created",
		}))
		.sort((a, b) => {
			if (!a.timestamp) return 1;
			if (!b.timestamp) return -1;
			return String(a.timestamp).localeCompare(String(b.timestamp));
		});
	return { kind: "timeline", events };
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

const RENDERERS = {
	temporal: renderTemporal,
	timeline: renderTimeline,
	relationship: renderRelationship,
	"mind-map": renderMindMap,
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
	renderRelationship,
	renderMindMap,
	applyBounds,
	compareProjections,
};
