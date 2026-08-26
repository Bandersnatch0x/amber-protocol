"use strict";

/**
 * Pure integrity analysis for the Canonical Artifact store (F049 ticket 04,
 * #221 — fail-closed admission integrity hardening).
 *
 * This module is deliberately I/O-free: it imports nothing and holds no
 * filesystem capability, so the detection layer can never become a repair
 * path. It computes verdicts over snapshots handed to it by the store
 * (scripts/lib/core/canonical-artifacts.js), which remains the only writer
 * of Bodies/Envelopes and the only appender of journal records:
 *
 * - findTraceCycle: walks a trace graph (refines / realizes / supersedes
 *   edges between committed revisions, across artifacts) and reports the
 *   first cycle it closes. Through the admission seam a cycle is
 *   structurally impossible — trace targets must already be committed and
 *   committed revisions are immutable, so every admission-written edge binds
 *   an older revision — but a hand-crafted store can contain one, and reads
 *   fail closed on it (AMBER_E_ARTIFACT_TRACE_CYCLE).
 * - danglingPreparedRevisions: the revisions whose prepared records never
 *   received a committed or aborted outcome — the residue of a crashed
 *   admission attempt. Deterministic settlement recovery (in the store)
 *   settles each of them by appending one `aborted` journal record; recovery
 *   never writes or rewrites a Body or Envelope.
 *
 * The guard test in tests/unit/canonical-artifacts.test.js asserts this
 * module's source stays free of filesystem access and write primitives —
 * keep it pure.
 */

/**
 * Find a cycle in a directed graph walked lazily from the given start nodes.
 *
 * Depth-first with white/gray/black coloring: a gray target is a back edge,
 * i.e. a cycle. The graph is walked through `edgesOf` only as far as the
 * start nodes reach, so callers can scope detection (a read of one artifact
 * walks its lineage; a store-wide read passes every committed revision).
 *
 * @param {Array<object>} startNodes - Nodes to walk from, each
 *        `{ type, identity, revision }` (a committed revision).
 * @param {(node: object) => Array<object>} edgesOf - The outgoing trace
 *        edges of one node, as target nodes of the same shape. The caller
 *        resolves traces (and may throw on unreadable state — failures
 *        propagate unchanged; detection never guesses through a hole).
 * @returns {Array<object>|null} The first cycle found, as a node path that
 *          starts and ends on the same node, or null when every node
 *          reachable from the start nodes is acyclic.
 */
function findTraceCycle(startNodes, edgesOf) {
	const keyOf = (node) => JSON.stringify([node?.type, node?.identity, node?.revision]);
	const WHITE = 0;
	const GRAY = 1;
	const BLACK = 2;
	const color = new Map();
	const stack = [];

	function visit(node) {
		const key = keyOf(node);
		color.set(key, GRAY);
		stack.push(key);
		for (const next of edgesOf(node)) {
			const nextKey = keyOf(next);
			const state = color.get(nextKey) ?? WHITE;
			if (state === GRAY) {
				const from = stack.indexOf(nextKey);
				const path = (from === -1 ? [...stack] : stack.slice(from)).concat(nextKey);
				return path.map(decodeKey);
			}
			if (state === WHITE) {
				const found = visit(next);
				if (found) return found;
			}
		}
		stack.pop();
		color.set(key, BLACK);
		return null;
	}

	for (const start of Array.isArray(startNodes) ? startNodes : []) {
		const key = keyOf(start);
		if ((color.get(key) ?? WHITE) === WHITE) {
			const found = visit(start);
			if (found) return found;
		}
	}
	return null;
}

// Rebuild the canonical node of a key produced by the walk's keyOf.
function decodeKey(key) {
	const [type, identity, revision] = JSON.parse(key);
	return { type, identity, revision };
}

/**
 * Revisions claimed by a prepared record that never received a committed or
 * aborted outcome — the residue of a crashed admission attempt. Each is
 * settled deterministically (as aborted) by recovery; none is ever promoted
 * to committed, and none ever becomes visible to reads.
 * @param {Array<object>} journal - Parsed journal records, in append order.
 * @returns {Array<number>} The dangling revision numbers, ascending.
 */
function danglingPreparedRevisions(journal) {
	const prepared = new Set();
	const settled = new Set();
	for (const record of Array.isArray(journal) ? journal : []) {
		if (typeof record?.revision !== "number" || !Number.isInteger(record.revision)) continue;
		if (record.kind === "prepared") prepared.add(record.revision);
		else if (record.kind === "committed" || record.kind === "aborted") settled.add(record.revision);
	}
	return [...prepared].filter((revision) => !settled.has(revision)).sort((a, b) => a - b);
}

module.exports = {
	findTraceCycle,
	danglingPreparedRevisions,
};
