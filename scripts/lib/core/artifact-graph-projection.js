"use strict";

/**
 * Pure derivation of the Governance Graph's Canonical Artifact layer
 * (F049 ticket 05, #222; ADR-0021).
 *
 * The Governance Graph is the ONLY graph projection and is never a write
 * authority (ADR-0021 #2/#3). This module turns a list of committed
 * artifact revision snapshots — handed to it by the strictly read-only
 * verification seam `listArtifactRevisions` in canonical-artifacts.js —
 * into graph nodes and typed trace edges, and nothing else. It is
 * deliberately I/O-free (it imports nothing and holds no filesystem
 * capability, exactly like canonical-artifact-verify.js), so no code path
 * from a projection rebuild or query can reach a Canonical Artifact write:
 * there is no way to call admission, append a journal record, or touch a
 * Body or Envelope from here. The guard test in
 * tests/unit/artifact-graph-projection.test.js asserts this module's source
 * stays free of imports and write primitives — keep it pure.
 *
 * Node/edge contract (ADR-0021 #3): a node is a read-only reference card
 * for ONE committed revision — identity, revision, lifecycle, scope,
 * binding hashes, and provenance. Nodes carry source references and
 * hashes; they never own mutable lifecycle state (the Envelope under
 * .amber/artifacts/ stays the only authority, and a lifecycle change is
 * always a new committed revision, i.e. a new node). Resolved Traces
 * become typed edges: the registered Trace type (refines / realizes /
 * supersedes) rides the edge `type` field, so a graph consumer can query
 * the Intent → Spec → Plan lineage directly.
 *
 * Determinism: identical committed state must produce an identical result
 * hash. Every array this module emits is canonically ordered (nodes by node
 * id, edges by source then target then type), so the projection output —
 * and therefore its hash — depends only on committed content, never on
 * directory iteration order or admission timing.
 *
 * Only fully committed revisions project (F049 spec: "Only fully committed
 * revisions are visible to projections and queries"). The read seam
 * enforces that: prepared and aborted revisions never appear in the
 * snapshot this module receives, and a corrupt store fails the read
 * before derivation starts — the projection never guesses around a hole
 * and is never partial (F035-S5), so corrupt revisions are excluded by
 * refusal, never by silent skipping.
 */

// Version of these projection rules (node shape, edge shape, ordering).
// Recorded in the rebuild receipt next to the Trace contract version so a
// rule change is visible as a different projection result, never a silent
// reinterpretation of the same output.
//
// Version 2 (ticket-05 review fix round, #222): a node's `committedAt` is
// sourced from the Envelope's own `committedAt` field — the one the
// envelopeHash covers — instead of the journal committed record's `at`
// (finding F-1), so every node field is covered by the source fingerprint
// the receipt checkpoints against. The graph's edge ordering was also made
// a total order with a canonical tiebreaker (finding F-2) — same edges for
// the same store, now independent of raw page `sources` key order.
//
// Version 3 (F055 acceptance review, P4): deletion tombstones. A committed
// revision named by a coordinated-deletion transaction projects as a
// tombstone — minimal stable identity plus the deletion transaction
// reference and its settlement status (`deleted` / `deletion-pending`) —
// with every content-bearing field (hashes, provenance, lifecycle, scope,
// committedAt) redacted and its outgoing trace edges withheld, so the
// projection cannot recreate or fingerprint deleted content (F055:
// "projections do not recreate content"). Tombstones arrive as data from
// the caller (the retention ledgers stay this module's only source through
// that seam), and untouched nodes carry `tombstone: null`.
const ARTIFACT_GRAPH_RULE_VERSION = 3;

const ARTIFACT_NODE_TYPE = "artifact-revision";

/**
 * The node id of one committed revision: `<type>/<identity>@<revision>`.
 * The same rendering the trace-cycle diagnostics use, so a node id names
 * exactly one revision of one artifact and can be resolved back through
 * `amber artifact show --type <type> --id <identity> --revision <n>`.
 */
function artifactGraphNodeId(type, identity, revision) {
	return `${type}/${identity}@${revision}`;
}

/**
 * The read-only reference card of one committed revision. A revision named
 * by a deletion transaction projects as a tombstone instead: minimal stable
 * identity plus the transaction reference — every content-bearing field is
 * redacted so the card cannot recreate or fingerprint deleted content.
 */
function artifactGraphNode(revision, tombstone = null) {
	const id = artifactGraphNodeId(revision.type, revision.identity, revision.revision);
	if (tombstone !== null) {
		return {
			id,
			type: ARTIFACT_NODE_TYPE,
			artifactType: revision.type,
			identity: revision.identity,
			revision: revision.revision,
			lifecycle: null,
			scope: null,
			supersedes: null,
			contentHash: null,
			envelopeHash: null,
			provenance: null,
			committedAt: null,
			tombstone: { status: tombstone.status, transactionId: tombstone.transactionId },
		};
	}
	return {
		id,
		type: ARTIFACT_NODE_TYPE,
		artifactType: revision.type,
		identity: revision.identity,
		revision: revision.revision,
		lifecycle: revision.lifecycle ?? null,
		scope: revision.scope ?? null,
		supersedes: revision.supersedes ?? null,
		contentHash: revision.contentHash ?? null,
		envelopeHash: revision.envelopeHash ?? null,
		provenance: revision.provenance ?? null,
		committedAt: revision.committedAt ?? null,
		tombstone: null,
	};
}

/** The typed trace edges of one committed revision. */
function artifactGraphEdgesOf(revision) {
	return (Array.isArray(revision.traces) ? revision.traces : []).map((trace) => ({
		source: artifactGraphNodeId(revision.type, revision.identity, revision.revision),
		target: artifactGraphNodeId(trace.to.type, trace.to.identity, trace.to.revision),
		type: trace.type,
	}));
}

function compareNodes(a, b) {
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareEdges(a, b) {
	if (a.source !== b.source) return a.source < b.source ? -1 : 1;
	if (a.target !== b.target) return a.target < b.target ? -1 : 1;
	if (a.type !== b.type) return a.type < b.type ? -1 : 1;
	return 0;
}

function compareRefs(a, b) {
	if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
	if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
	return a[2] - b[2];
}

// One tombstone per record, chosen deterministically when several deletion
// transactions name the same revision: a settled `deleted` beats a
// `deletion-pending`, then the lexicographically smallest transaction id —
// never input order.
function tombstoneIndex(tombstones) {
	const byId = new Map();
	for (const entry of Array.isArray(tombstones) ? tombstones : []) {
		const record = entry?.record;
		if (!record) continue;
		const id = artifactGraphNodeId(record.type, record.identity, record.revision);
		const current = byId.get(id);
		if (current === undefined || tombstonePrecedes(entry, current)) byId.set(id, entry);
	}
	return byId;
}

function tombstonePrecedes(a, b) {
	if (a.status !== b.status) return a.status === "deleted";
	return a.transactionId < b.transactionId;
}

/**
 * The artifact layer of the Governance Graph: one node per committed
 * revision and one typed edge per resolved Trace, canonically ordered.
 * Revisions named by a deletion transaction project as redacted tombstone
 * nodes and their outgoing trace edges are withheld (rule v3) — edges from
 * live revisions TOWARD a tombstone survive, because they derive from the
 * live revision's own committed content.
 * @param {Array<object>} revisions - Committed revision snapshots in any
 *        order; the layer output is ordered canonically so it is a pure
 *        function of the committed content.
 * @param {Array<object>} tombstones - Deletion tombstone entries
 *        (`{record, transactionId, status}`) from the retention seam.
 * @returns {{nodes: Array<object>, edges: Array<object>, ruleVersion: number}}
 */
function artifactGraphLayer(revisions, tombstones = []) {
	const list = Array.isArray(revisions) ? revisions : [];
	const index = tombstoneIndex(tombstones);
	const idOf = (revision) =>
		artifactGraphNodeId(revision.type, revision.identity, revision.revision);
	const nodes = list
		.map((revision) => artifactGraphNode(revision, index.get(idOf(revision)) ?? null))
		.sort(compareNodes);
	const edges = list
		.filter((revision) => !index.has(idOf(revision)))
		.flatMap(artifactGraphEdgesOf)
		.sort(compareEdges);
	return { nodes, edges, ruleVersion: ARTIFACT_GRAPH_RULE_VERSION };
}

/**
 * The tamper-evident source fingerprint of the artifact layer: the
 * committed revision references with their Envelope hashes, canonically
 * ordered. The Envelope hash covers the full revision content (bodyHash,
 * provenance, lifecycle, scope, resolved traces), so this summary changes
 * exactly when the committed artifact state changes — nothing else. The
 * caller, which owns the hash primitive, folds it into the projection's
 * source checkpoint.
 * @param {Array<object>} revisions - Committed revision snapshots.
 * @returns {Array<Array>} Sorted `[type, identity, revision, envelopeHash]`
 *          tuples.
 */
function artifactSourceFingerprint(revisions) {
	return (Array.isArray(revisions) ? revisions : [])
		.map((revision) => [
			revision.type,
			revision.identity,
			revision.revision,
			revision.envelopeHash ?? null,
		])
		.sort(compareRefs);
}

/**
 * The canonical fingerprint of the deletion tombstone state: sorted
 * `[type, identity, revision, transactionId, status]` tuples. The caller
 * folds it into the projection's source checkpoint so a new or settled
 * deletion transaction drifts the projection instead of leaving a stale
 * content-bearing graph certified current.
 * @param {Array<object>} tombstones - Deletion tombstone entries.
 * @returns {Array<Array>} Sorted tuples.
 */
function tombstoneFingerprint(tombstones) {
	return (Array.isArray(tombstones) ? tombstones : [])
		.map((entry) => [
			entry.record.type,
			entry.record.identity,
			entry.record.revision,
			entry.transactionId,
			entry.status,
		])
		.sort((a, b) => {
			for (let i = 0; i < a.length; i += 1) {
				if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
			}
			return 0;
		});
}

module.exports = {
	ARTIFACT_GRAPH_RULE_VERSION,
	ARTIFACT_NODE_TYPE,
	artifactGraphNodeId,
	artifactGraphNode,
	artifactGraphEdgesOf,
	artifactGraphLayer,
	artifactSourceFingerprint,
	tombstoneFingerprint,
};
