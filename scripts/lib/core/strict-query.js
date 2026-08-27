"use strict";

// F050 ticket 6 (#231) — strict read contract for the Governance Graph.
// Strict reads bind every parameter that matters for a Gate: exact scope,
// source checkpoint, projection version, bounded limit, ordering, depth, and
// expiring cursor. If the source checkpoint moved, a cursor expired, or scoped
// dependencies have been invalidated, the query fails closed instead of
// returning a partial/degraded result that could satisfy a strict Gate.

const {
	governanceGraphSource,
	governanceGraphCheckpoint,
	governanceGraphFromState,
} = require("./governance-graph");
const { invalidationsForSubject } = require("./staleness-registry");
const { sha256Hex } = require("./context-hash");

const STRICT_QUERY_VERSION = 1;
const PROJECTION_VERSION = 1;
const CURSOR_TTL_MS = 5 * 60 * 1000;
const MAX_LIMIT = 100;
const SORTS = Object.freeze(["id"]);
const DEPTHS = Object.freeze([0, 1]);

const INVALID_CODE = "AMBER_E_STRICT_QUERY_INVALID";
const CHECKPOINT_MISMATCH_CODE = "AMBER_E_STRICT_QUERY_CHECKPOINT_MISMATCH";
const STALE_CODE = "AMBER_E_STRICT_QUERY_STALE";
const CURSOR_INVALID_CODE = "AMBER_E_STRICT_QUERY_CURSOR_INVALID";
const CURSOR_EXPIRED_CODE = "AMBER_E_STRICT_QUERY_CURSOR_EXPIRED";

function fail(code, errors, extra = {}) {
	return {
		ok: false,
		code,
		nodes: [],
		truncated: false,
		cursor: null,
		degraded: true,
		gateSatisfiable: false,
		errors,
		...extra,
	};
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value) {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function cursorSignature(payload) {
	return sha256Hex(JSON.stringify({ ...payload, sig: null }));
}

function encodeCursor(payload) {
	const body = { ...payload, sig: null };
	body.sig = cursorSignature(body);
	return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
	try {
		const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		if (typeof parsed.sig !== "string" || parsed.sig !== cursorSignature(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

function normalizeInput(input = {}) {
	const scope = input.scope;
	if (!isNonEmptyString(scope))
		return { error: "scope is required and must be a non-empty exact graph node id" };
	const checkpoint = input.checkpoint;
	if (!isSha256(checkpoint))
		return { error: `checkpoint must be sha256:<64 hex>; got ${JSON.stringify(checkpoint)}` };
	const projectionVersion = Number(input.projectionVersion);
	if (projectionVersion !== PROJECTION_VERSION) {
		return {
			error: `projectionVersion must be ${PROJECTION_VERSION}; got ${JSON.stringify(input.projectionVersion)}`,
		};
	}
	const limit = Number(input.limit);
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
		return {
			error: `limit must be an integer in [1, ${MAX_LIMIT}]; got ${JSON.stringify(input.limit)}`,
		};
	}
	if (input.sort === undefined || input.sort === null || input.sort === "") {
		return { error: "sort is required for strict queries and must be explicitly set to id" };
	}
	const sort = input.sort;
	if (!SORTS.includes(sort))
		return { error: `sort must be one of ${SORTS.join(", ")}; got ${JSON.stringify(sort)}` };
	if (input.depth === undefined || input.depth === null || input.depth === "") {
		return {
			error: `depth is required for strict queries and must be one of ${DEPTHS.join(", ")}`,
		};
	}
	const depth = Number(input.depth);
	if (!DEPTHS.includes(depth))
		return {
			error: `depth must be one of ${DEPTHS.join(", ")}; got ${JSON.stringify(input.depth)}`,
		};
	return { scope, checkpoint, projectionVersion, limit, sort, depth, cursor: input.cursor || null };
}

function cursorProblem(cursor, normalized, nowMs) {
	if (cursor === null) return { offset: 0, error: null };
	const decoded = decodeCursor(cursor);
	if (decoded === null)
		return {
			offset: 0,
			error: { code: CURSOR_INVALID_CODE, message: "cursor is not a valid strict-query cursor" },
		};
	for (const key of ["scope", "checkpoint", "projectionVersion", "limit", "sort", "depth"]) {
		if (decoded[key] !== normalized[key]) {
			return {
				offset: 0,
				error: {
					code: CURSOR_INVALID_CODE,
					message: `cursor ${key} ${JSON.stringify(decoded[key])} does not match request ${JSON.stringify(normalized[key])}`,
				},
			};
		}
	}
	if (!Number.isInteger(decoded.offset) || decoded.offset < 0) {
		return { offset: 0, error: { code: CURSOR_INVALID_CODE, message: "cursor offset is invalid" } };
	}
	if (!Number.isInteger(decoded.total) || decoded.total < 1) {
		return { offset: 0, error: { code: CURSOR_INVALID_CODE, message: "cursor total is invalid" } };
	}
	if (decoded.offset >= decoded.total) {
		return {
			offset: 0,
			error: { code: CURSOR_INVALID_CODE, message: "cursor offset is beyond the result set" },
		};
	}
	if (!Number.isInteger(decoded.expiresAt) || nowMs >= decoded.expiresAt) {
		return {
			offset: 0,
			error: { code: CURSOR_EXPIRED_CODE, message: "strict-query cursor has expired" },
		};
	}
	return { offset: decoded.offset, total: decoded.total, error: null };
}

function scopedNodes(graph, scope, depth) {
	const root = graph.nodes.find((node) => node.id === scope);
	if (!root) return null;
	if (depth === 0) return [root];
	const ids = new Set([root.id]);
	for (const edge of graph.edges) {
		if (edge.source === root.id || edge.target === root.id) {
			ids.add(edge.source);
			ids.add(edge.target);
		}
	}
	return graph.nodes.filter((node) => ids.has(node.id)).sort((a, b) => a.id.localeCompare(b.id));
}

function strictGovernanceGraphQuery(cwd, input = {}, opts = {}) {
	const normalized = normalizeInput(input);
	if (normalized.error) return fail(INVALID_CODE, [normalized.error]);
	const now = opts.now instanceof Date ? opts.now : new Date();
	const nowMs = now.getTime();
	const cursor = cursorProblem(normalized.cursor, normalized, nowMs);
	if (cursor.error) return fail(cursor.error.code, [cursor.error.message]);

	let source;
	try {
		source = governanceGraphSource(cwd);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_PROJECTION_DRIFT", [err.message || String(err)]);
	}
	const checkpoint = governanceGraphCheckpoint(source);
	if (checkpoint !== normalized.checkpoint) {
		return fail(
			CHECKPOINT_MISMATCH_CODE,
			[
				`strict query checkpoint ${normalized.checkpoint} does not match current source checkpoint ${checkpoint}`,
			],
			{ currentCheckpoint: checkpoint },
		);
	}
	let invalidations;
	try {
		invalidations = invalidationsForSubject(cwd, normalized.scope);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_STALENESS_REGISTRY_CORRUPT", [
			err.message || String(err),
		]);
	}
	if (invalidations.length > 0) {
		return fail(
			STALE_CODE,
			[
				`strict query scope "${normalized.scope}" has ${invalidations.length} invalidation receipt(s); degraded/stale reads cannot satisfy strict Gates`,
			],
			{ invalidations },
		);
	}

	let graph;
	try {
		graph = governanceGraphFromState(source);
	} catch (err) {
		return fail(err.amberCode || "AMBER_E_PROJECTION_DRIFT", [err.message || String(err)]);
	}
	const nodes = scopedNodes(graph, normalized.scope, normalized.depth);
	if (nodes === null) {
		return fail("AMBER_E_GRAPH_DENY", [`unknown scope "${normalized.scope}" denied`], {
			checkpoint,
		});
	}
	const end = cursor.offset + normalized.limit;
	const page = nodes.slice(cursor.offset, end);
	const truncated = end < nodes.length;
	const nextCursor = truncated
		? encodeCursor({
				...normalized,
				offset: end,
				total: nodes.length,
				expiresAt: nowMs + CURSOR_TTL_MS,
			})
		: null;
	const completeFromStart = cursor.offset === 0 && !truncated;
	return {
		ok: true,
		code: null,
		nodes: page,
		truncated,
		cursor: nextCursor,
		degraded: !completeFromStart,
		gateSatisfiable: completeFromStart,
		checkpoint,
		projectionVersion: PROJECTION_VERSION,
		limit: normalized.limit,
		sort: normalized.sort,
		depth: normalized.depth,
		errors: [],
	};
}

module.exports = {
	STRICT_QUERY_VERSION,
	PROJECTION_VERSION,
	CURSOR_TTL_MS,
	MAX_LIMIT,
	strictGovernanceGraphQuery,
	encodeCursor,
	decodeCursor,
};
