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
 * F049 ticket 06 (#223, routed finding 2): the walk is ITERATIVE — an
 * explicit stack of frames plus a gray-path array, never recursion. A deep
 * but valid lineage (e.g. a 10k-artifact linear supersedes chain) is walked
 * to completion; the previous recursive form overflowed the call stack and
 * surfaced as the wrong error (a raw RangeError — or worse,
 * AMBER_E_ARTIFACT_NOT_FOUND from the CLI's fallback — instead of a verdict),
 * which is exactly the fail-open hole a bounded-store read must not have.
 * Depth is therefore bounded only by memory, and the walk semantics are
 * unchanged: same start order, same edge order, same first-cycle path.
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
	const grayPath = []; // keys of the current DFS path, root first

	for (const start of Array.isArray(startNodes) ? startNodes : []) {
		const startKey = keyOf(start);
		if ((color.get(startKey) ?? WHITE) !== WHITE) continue;
		// Frame: { key, node, edges, index } — `edges` is resolved lazily on
		// first visit and `index` is the next outgoing edge to take, so
		// edgesOf runs exactly once per node, exactly like the recursive form.
		const stack = [{ key: startKey, node: start, edges: null, index: 0 }];
		color.set(startKey, GRAY);
		grayPath.push(startKey);
		while (stack.length > 0) {
			const frame = stack[stack.length - 1];
			if (frame.edges === null) frame.edges = edgesOf(frame.node);
			if (frame.index < frame.edges.length) {
				const next = frame.edges[frame.index];
				frame.index += 1;
				const nextKey = keyOf(next);
				const state = color.get(nextKey) ?? WHITE;
				if (state === GRAY) {
					// Back edge: the cycle is the gray chain from the first
					// occurrence of nextKey to the current frame, closed.
					const from = grayPath.indexOf(nextKey);
					const path = (from === -1 ? [...grayPath] : grayPath.slice(from)).concat(nextKey);
					return path.map(decodeKey);
				}
				if (state === WHITE) {
					color.set(nextKey, GRAY);
					grayPath.push(nextKey);
					stack.push({ key: nextKey, node: next, edges: null, index: 0 });
				}
			} else {
				color.set(frame.key, BLACK);
				grayPath.pop();
				stack.pop();
			}
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
