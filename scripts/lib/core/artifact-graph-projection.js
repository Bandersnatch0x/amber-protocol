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
const ARTIFACT_GRAPH_RULE_VERSION = 1;

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

/** The read-only reference card of one committed revision. */
function artifactGraphNode(revision) {
	return {
		id: artifactGraphNodeId(revision.type, revision.identity, revision.revision),
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

/**
 * The artifact layer of the Governance Graph: one node per committed
 * revision and one typed edge per resolved Trace, canonically ordered.
 * @param {Array<object>} revisions - Committed revision snapshots in any
 *        order; the layer output is ordered canonically so it is a pure
 *        function of the committed content.
 * @returns {{nodes: Array<object>, edges: Array<object>, ruleVersion: number}}
 */
function artifactGraphLayer(revisions) {
	const list = Array.isArray(revisions) ? revisions : [];
	const nodes = list.map(artifactGraphNode).sort(compareNodes);
	const edges = list.flatMap(artifactGraphEdgesOf).sort(compareEdges);
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

module.exports = {
	ARTIFACT_GRAPH_RULE_VERSION,
	ARTIFACT_NODE_TYPE,
	artifactGraphNodeId,
	artifactGraphNode,
	artifactGraphEdgesOf,
	artifactGraphLayer,
	artifactSourceFingerprint,
};
