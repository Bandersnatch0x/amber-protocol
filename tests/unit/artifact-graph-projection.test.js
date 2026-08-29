"use strict";

// F049 ticket 05 (#222) — Governance Graph projection of Canonical Artifact
// revisions.
//
// Every fixture drives the public seams only: the artifact store's admission
// API (the write authority), the strictly read-only revision seam, the
// governance-graph builder/query contract, and the projection registry's
// rebuild. Assertions check externally visible state — never store internals.
//
// AC map:
//  1. nodes + typed edges ............ "committed Intent/Spec/Plan revisions
//                                       project as graph nodes..." and
//                                       "artifact nodes are read-only
//                                       reference cards..."
//  2. determinism + receipt .......... "rebuilding the same committed state
//                                       produces an identical result hash...",
//                                       "the rebuild receipt records...",
//                                       "the source checkpoint covers..."
//  3. non-authority .................. "the artifact graph derivation module
//                                       holds no I/O...", "a rebuild never
//                                       writes..."
//  4. committed-only + fail closed ... "prepared and aborted revisions are
//                                       never projected", "a corrupt artifact
//                                       store fails the rebuild closed..."
//  5. bounded queries ................ the three queryGraph tests
//  6. public-seam fixtures ........... tests/amber-cli-artifact-graph-projection.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	admitArtifact,
	listArtifactRevisions,
} = require("../../scripts/lib/core/canonical-artifacts");
const {
	buildGovernanceGraph,
	governanceGraphSource,
	governanceGraphCheckpoint,
	governanceGraphFromState,
	queryGraph,
} = require("../../scripts/lib/core/governance-graph");
const {
	ARTIFACT_GRAPH_RULE_VERSION,
	artifactGraphLayer,
} = require("../../scripts/lib/core/artifact-graph-projection");
const { TRACE_REGISTRY_VERSION } = require("../../scripts/lib/core/canonical-artifact-contracts");
const {
	SCHEMA_VERSION,
	rebuildProjection,
	projectionStatus,
	sha256,
} = require("../../scripts/lib/core/projection-registry");
const { mkTarget, addPage } = require("../helpers/harness");

const INTENT_BODY = "# Intent: fix the login bug\n\nUsers cannot log in.\n";
const SPEC_BODY = "# Spec: login\n\nThe login form must submit.\n";
const PLAN_BODY = "# Plan: login\n\nThree vertical slices.\n";

function admitOk(dir, options) {
	const result = admitArtifact(dir, options);
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	return result.receipt;
}

// The full planning lineage fixture: Intent (draft -> accepted), a Spec that
// refines the accepted Intent revision (draft -> approved), and a Plan that
// realizes the approved Spec revision. Five committed revisions.
function buildLineage(dir) {
	admitOk(dir, { type: "intent", identity: "intent/login-bug", body: INTENT_BODY });
	admitOk(dir, {
		type: "intent",
		identity: "intent/login-bug",
		body: INTENT_BODY,
		expectedHead: 1,
		transition: "accept",
	});
	admitOk(dir, {
		type: "spec",
		identity: "spec/login-spec",
		body: SPEC_BODY,
		traces: [
			{ type: "refines", to: { type: "intent", identity: "intent/login-bug", revision: 2 } },
		],
	});
	admitOk(dir, {
		type: "spec",
		identity: "spec/login-spec",
		body: SPEC_BODY,
		expectedHead: 1,
		transition: "approve",
		traces: [
			{ type: "refines", to: { type: "intent", identity: "intent/login-bug", revision: 2 } },
		],
	});
	admitOk(dir, {
		type: "plan",
		identity: "plan/login-plan",
		body: PLAN_BODY,
		traces: [{ type: "realizes", to: { type: "spec", identity: "spec/login-spec", revision: 2 } }],
	});
}

function artifactNodeIds(nodes) {
	return nodes.map((n) => n.id).filter((id) => id.includes("@"));
}

function traceEdgesOf(edges) {
	const TRACE_TYPES = ["refines", "realizes", "supersedes"];
	return edges
		.filter((e) => TRACE_TYPES.includes(e.type))
		.map((e) => `${e.source} -${e.type}-> ${e.target}`)
		.sort();
}

// Recursive content snapshot of a directory tree: relative path -> sha256 of
// the file bytes. Used by the non-authority tests to prove a rebuild leaves
// the artifact store byte-identical.
function snapshotTree(root) {
	const files = {};
	if (!fs.existsSync(root)) return files;
	const walk = (rel) => {
		const abs = path.join(root, rel);
		for (const name of fs.readdirSync(abs).sort()) {
			const childRel = rel ? `${rel}/${name}` : name;
			const childAbs = path.join(root, childRel);
			if (fs.statSync(childAbs).isDirectory()) {
				walk(childRel);
			} else {
				files[childRel] = require("node:crypto")
					.createHash("sha256")
					.update(fs.readFileSync(childAbs))
					.digest("hex");
			}
		}
	};
	walk("");
	return files;
}

function governanceGraphBuilder(state) {
	const graph = governanceGraphFromState(state);
	return {
		projection: "governance-graph",
		graphHash: graph.sourceHash,
		nodes: graph.nodes,
		edges: graph.edges,
	};
}

// The rebuild options the CLI passes: rule versions ride the receipt.
const REBUILD_OPTIONS = {
	manifestFields: {
		projection_rule_versions: {
			artifactGraph: ARTIFACT_GRAPH_RULE_VERSION,
			traceContract: TRACE_REGISTRY_VERSION,
		},
	},
};

// ── AC 1: committed revisions as nodes, Traces as typed edges ──

test("committed Intent/Spec/Plan revisions project as graph nodes and Traces as typed edges", () => {
	const dir = mkTarget("t05-lineage");
	buildLineage(dir);

	const graph = buildGovernanceGraph(dir);
	assert.deepEqual(artifactNodeIds(graph.nodes), [
		"intent/intent/login-bug@1",
		"intent/intent/login-bug@2",
		"plan/plan/login-plan@1",
		"spec/spec/login-spec@1",
		"spec/spec/login-spec@2",
	]);
	// Typed edges: the registered Trace type rides the edge `type` field, so
	// the Intent -> Spec -> Plan planning lineage is queryable directly.
	assert.deepEqual(traceEdgesOf(graph.edges), [
		"plan/plan/login-plan@1 -realizes-> spec/spec/login-spec@2",
		"spec/spec/login-spec@1 -refines-> intent/intent/login-bug@2",
		"spec/spec/login-spec@2 -refines-> intent/intent/login-bug@2",
	]);
});

test("artifact nodes are read-only reference cards carrying revision, lifecycle, hashes, and provenance", () => {
	const dir = mkTarget("t05-node-shape");
	buildLineage(dir);

	const graph = buildGovernanceGraph(dir);
	const accepted = graph.nodes.find((n) => n.id === "intent/intent/login-bug@2");
	assert.ok(accepted, "accepted intent revision is a node");
	assert.equal(accepted.type, "artifact-revision");
	assert.equal(accepted.artifactType, "intent");
	assert.equal(accepted.identity, "intent/login-bug");
	assert.equal(accepted.revision, 2);
	assert.equal(accepted.lifecycle, "accepted");
	assert.equal(accepted.supersedes, 1, "revision-level succession is carried as a reference");
	assert.match(
		accepted.contentHash,
		/^sha256:[0-9a-f]{64}$/,
		"body hash carries the sha256: prefix",
	);
	assert.match(
		accepted.envelopeHash,
		/^[0-9a-f]{64}$/,
		"envelope hash is the store's bare canonical hash",
	);
	assert.ok(accepted.committedAt, "provenance: committed timestamp from the Envelope");

	// The node carries the store's binding hashes verbatim — it references
	// the committed revision, it never owns the lifecycle state.
	const revisions = listArtifactRevisions(dir);
	const committed = revisions.find((r) => r.type === "intent" && r.revision === 2);
	assert.equal(accepted.contentHash, committed.contentHash);
	assert.equal(accepted.envelopeHash, committed.envelopeHash);

	// Page nodes and artifact revision nodes coexist in one graph (ADR-0021:
	// the Governance Graph is the ONLY graph projection).
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "docs/spec.md" } } });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: { kind: "repo", ref: "docs/spec.md" } } });
	const merged = buildGovernanceGraph(dir);
	assert.ok(merged.nodes.some((n) => n.id === "p1" && n.type === "context-page"));
	assert.ok(merged.nodes.some((n) => n.id === "intent/intent/login-bug@2"));
	assert.ok(
		merged.edges.some((e) => e.source === "p1" && e.target === "p2" && e.type === "shares-source"),
		"page edges survive the artifact extension",
	);
});

// ── AC 2: deterministic rebuild + receipt ──────────────────────

test("rebuilding the same committed state produces an identical result hash (deterministic)", () => {
	const dir = mkTarget("t05-deterministic");
	buildLineage(dir);

	const first = rebuildProjection(dir, "governance-graph", governanceGraphBuilder, REBUILD_OPTIONS);
	assert.equal(first.ok, true, first.errors.join("; "));
	const second = rebuildProjection(
		dir,
		"governance-graph",
		governanceGraphBuilder,
		REBUILD_OPTIONS,
	);
	assert.equal(second.ok, true, second.errors.join("; "));
	assert.equal(second.manifest.outputHash, first.manifest.outputHash, "identical result hash");
	assert.equal(
		second.manifest.rebuild_checkpoint,
		first.manifest.rebuild_checkpoint,
		"identical source checkpoint",
	);
	assert.equal(second.manifest.sourceHash, first.manifest.sourceHash);

	// Determinism against source iteration order: the same committed content
	// fed in reversed order yields the identical graph and hash.
	const source = governanceGraphSource(dir);
	const straight = governanceGraphFromState(source);
	const reversed = governanceGraphFromState({
		artifacts: [...source.artifacts].reverse(),
		artifactRevisions: [...source.artifactRevisions].reverse(),
	});
	assert.equal(reversed.sourceHash, straight.sourceHash);
	assert.deepEqual(reversed.nodes, straight.nodes);
	assert.deepEqual(reversed.edges, straight.edges);
});

test("the rebuild receipt records source checkpoint, rule versions, schema version, and result hash", () => {
	const dir = mkTarget("t05-receipt");
	buildLineage(dir);

	const built = rebuildProjection(dir, "governance-graph", governanceGraphBuilder, REBUILD_OPTIONS);
	assert.equal(built.ok, true, built.errors.join("; "));
	const manifest = built.manifest;
	// Source checkpoint: the receipt's checkpoint is the tamper-evident
	// digest of the projection's canonical sources (pages + committed
	// artifact revisions) at rebuild time.
	assert.equal(manifest.rebuild_checkpoint, governanceGraphCheckpoint(governanceGraphSource(dir)));
	assert.equal(manifest.sourceHash, manifest.rebuild_checkpoint);
	assert.match(manifest.outputHash, /^sha256:[0-9a-f]{64}$/);
	// Result hash: the receipt's outputHash is the hash of the durable
	// projection output written next to it.
	assert.equal(manifest.outputHash, sha256(fs.readFileSync(built.outputPath, "utf8")));
	// Rule versions: the projection rules and the Trace contract the layer
	// was derived under.
	assert.deepEqual(manifest.projection_rule_versions, {
		artifactGraph: ARTIFACT_GRAPH_RULE_VERSION,
		traceContract: TRACE_REGISTRY_VERSION,
	});
	// Schema + protocol provenance.
	assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
	assert.equal(typeof manifest.amber_protocol_version, "string");
	assert.ok(manifest.amber_protocol_version.length > 0);
	// The written manifest is the receipt (the projection registry owns the
	// durable copy under .amber/projections/).
	const onDisk = JSON.parse(fs.readFileSync(built.manifestPath, "utf8"));
	assert.deepEqual(onDisk.projection_rule_versions, manifest.projection_rule_versions);
	assert.equal(onDisk.outputHash, manifest.outputHash);
});

test("the source checkpoint covers committed artifact revisions — a new revision drifts the projection", () => {
	const dir = mkTarget("t05-checkpoint");
	buildLineage(dir);

	const before = governanceGraphCheckpoint(governanceGraphSource(dir));
	const built = rebuildProjection(dir, "governance-graph", governanceGraphBuilder, REBUILD_OPTIONS);
	assert.equal(built.ok, true, built.errors.join("; "));
	assert.equal(projectionStatus(dir, "governance-graph").ok, true, "current right after rebuild");

	// Approving the Plan commits a new revision: committed state changed, so
	// the checkpoint changes and the projection no longer certifies current.
	admitOk(dir, {
		type: "plan",
		identity: "plan/login-plan",
		body: PLAN_BODY,
		expectedHead: 1,
		transition: "approve",
		traces: [{ type: "realizes", to: { type: "spec", identity: "spec/login-spec", revision: 2 } }],
	});
	const after = governanceGraphCheckpoint(governanceGraphSource(dir));
	assert.notEqual(after, before, "checkpoint moves with committed state");
	const status = projectionStatus(dir, "governance-graph");
	assert.equal(status.ok, false);
	assert.equal(status.code, "AMBER_E_PROJECTION_DRIFT");
});

// ── AC 2 (review fix round): checkpoint-covered determinism ────

// Ticket-05 review finding F-1: the journal committed record's `at` sits
// outside the source fingerprint, so it must not feed the projection output
// — the node's committedAt comes from the hash-covered Envelope field. A
// hand-edited journal timestamp therefore leaves both the checkpoint AND the
// result hash untouched across rebuilds.
test("a hand-edited journal committed timestamp cannot change the projection output", () => {
	const dir = mkTarget("t05-journal-at");
	buildLineage(dir);

	const first = rebuildProjection(dir, "governance-graph", governanceGraphBuilder, REBUILD_OPTIONS);
	assert.equal(first.ok, true, first.errors.join("; "));

	// Hand-edit every committed record's `at` in one artifact's journal — the
	// field no integrity check covers.
	const journalFile = path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		"intent_login-bug",
		"journal.jsonl",
	);
	const edited = fs
		.readFileSync(journalFile, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const record = JSON.parse(line);
			if (record.kind === "committed") record.at = "2000-01-01T00:00:00.000Z";
			return JSON.stringify(record);
		});
	fs.writeFileSync(journalFile, edited.join("\n") + "\n", "utf8");

	const second = rebuildProjection(
		dir,
		"governance-graph",
		governanceGraphBuilder,
		REBUILD_OPTIONS,
	);
	assert.equal(second.ok, true, second.errors.join("; "));
	assert.equal(
		second.manifest.rebuild_checkpoint,
		first.manifest.rebuild_checkpoint,
		"the journal `at` is outside the source fingerprint",
	);
	assert.equal(
		second.manifest.outputHash,
		first.manifest.outputHash,
		"same checkpoint, same result hash — the output no longer depends on the journal record",
	);

	// The served node's committedAt is the Envelope's own committedAt (the
	// field the envelopeHash covers), never the edited journal timestamp.
	const graph = buildGovernanceGraph(dir);
	const node = graph.nodes.find((n) => n.id === "intent/intent/login-bug@2");
	const revision = listArtifactRevisions(dir).find((r) => r.type === "intent" && r.revision === 2);
	const envelope = JSON.parse(
		fs.readFileSync(
			path.join(dir, ".amber", "artifacts", "intents", "intent_login-bug", "rev-2.envelope.json"),
			"utf8",
		),
	);
	assert.equal(node.committedAt, revision.committedAt);
	assert.equal(node.committedAt, envelope.committedAt);
	assert.notEqual(node.committedAt, "2000-01-01T00:00:00.000Z");
});

// Ticket-05 review finding F-2: the checkpoint canonicalizes key order, so
// two page stores differing only in raw `sources` key order share a
// checkpoint — the graph output (and its hash) must not be able to differ
// for canonically identical state.
test("page stores differing only in raw sources key order share checkpoint and graph hash", () => {
	const dirA = mkTarget("t05-key-order-a");
	const dirB = mkTarget("t05-key-order-b");
	const refX = { kind: "repo", ref: "docs/x.md" };
	const refY = { kind: "repo", ref: "docs/y.md" };
	for (const dir of [dirA, dirB]) {
		addPage(dir, "p1", { title: "Page 1", sources: { sx: refX, sy: refY } });
		addPage(dir, "p2", { title: "Page 2", sources: { sx: refX, sy: refY } });
	}

	// Variant B: identical page content, only the raw key order inside p1's
	// `sources` object differs (canonically identical state).
	const p1File = path.join(dirB, ".amber", "context", "pages", "p1.json");
	const p1 = JSON.parse(fs.readFileSync(p1File, "utf8"));
	fs.writeFileSync(
		p1File,
		JSON.stringify({ ...p1, sources: { sy: p1.sources.sy, sx: p1.sources.sx } }),
		"utf8",
	);

	const stateA = governanceGraphSource(dirA);
	const stateB = governanceGraphSource(dirB);
	assert.equal(
		governanceGraphCheckpoint(stateB),
		governanceGraphCheckpoint(stateA),
		"canonically identical stores share a checkpoint",
	);

	const graphA = governanceGraphFromState(stateA);
	const graphB = governanceGraphFromState(stateB);
	assert.equal(
		graphB.sourceHash,
		graphA.sourceHash,
		"identical canonical state produces the identical graph hash",
	);
	assert.deepEqual(graphB.edges, graphA.edges);

	// The order-tied pair — two pages sharing two refs — is canonically
	// ordered: the edge list resolves the (source, target, type) tie by the
	// shared ref, so the docs/x.md edge precedes the docs/y.md edge in both
	// stores regardless of key order.
	const shared = graphA.edges.filter((e) => e.type === "shares-source");
	assert.deepEqual(
		shared.map((e) => `${e.source}->${e.target} ${e.ref}`),
		["p1->p2 docs/x.md", "p1->p2 docs/y.md"],
		"order-tied page edges are ref-sorted, never key-order residue",
	);
});

// ── AC 3: the projection is read-only, never a write authority ──

test("the artifact graph derivation module holds no I/O or write capability (no repair path)", () => {
	// Structural guard in the ticket-04 style: derivation lives in a
	// deliberately pure module, so no code path from a projection rebuild or
	// query can reach a Canonical Artifact write — there is no way to admit,
	// append a journal record, or touch a Body or Envelope from the
	// projection layer.
	const modulePath = path.join(
		__dirname,
		"..",
		"..",
		"scripts",
		"lib",
		"core",
		"artifact-graph-projection.js",
	);
	const source = fs.readFileSync(modulePath, "utf8");
	assert.doesNotMatch(source, /require\s*\(/, "the pure module must import nothing");
	assert.doesNotMatch(
		source,
		/writeFileSync|appendFileSync|readFileSync|rmSync|unlinkSync|mkdirSync|openSync|renameSync|copyFileSync|truncateSync|\bprocess\./,
		"the pure module must hold no filesystem or process capability",
	);
	const derivation = require("../../scripts/lib/core/artifact-graph-projection");
	for (const name of Object.keys(derivation)) {
		assert.doesNotMatch(
			name,
			/set|update|mutate|rewrite|edit|write|repair|recover|append|admit|settle|abort/i,
			`${name} must stay a pure derivation`,
		);
	}
});

test("a rebuild and its queries never write to the Canonical Artifact store", () => {
	const dir = mkTarget("t05-no-writes");
	buildLineage(dir);

	const artifactsRoot = path.join(dir, ".amber", "artifacts");
	const before = snapshotTree(artifactsRoot);

	// The full projection round-trip: read seam, graph build, registry
	// rebuild, bounded query.
	listArtifactRevisions(dir);
	const graph = buildGovernanceGraph(dir);
	const query = queryGraph(graph, { scope: "spec/spec/login-spec@1" });
	assert.equal(query.ok, true);
	const built = rebuildProjection(dir, "governance-graph", governanceGraphBuilder, REBUILD_OPTIONS);
	assert.equal(built.ok, true, built.errors.join("; "));

	assert.deepEqual(snapshotTree(artifactsRoot), before, "artifact store is byte-identical");
	// The only writes landed in the projection store, never in the artifact
	// store — and the journal gained no recovery record through the read.
	assert.ok(fs.existsSync(path.join(dir, ".amber", "projections", "governance-graph.json")));
	assert.equal(
		JSON.stringify(snapshotTree(artifactsRoot)) === JSON.stringify(before),
		true,
		"no journal append, no recovery record, no Body/Envelope touch",
	);
});

// ── AC 4: committed-only visibility; corruption fails closed ────

test("prepared and aborted revisions are never projected", () => {
	const dir = mkTarget("t05-committed-only");
	buildLineage(dir);

	// A crashed admission: a home whose journal stops at prepared. Slot 1 is
	// claimed (the settlement replay rejects numbering that starts away
	// from 1), but it is never settled, so it must stay invisible.
	const ghostHome = path.join(dir, ".amber", "artifacts", "intents", "intent_ghost");
	fs.mkdirSync(ghostHome, { recursive: true });
	fs.writeFileSync(path.join(ghostHome, "rev-1.md"), "# ghost body\n");
	fs.writeFileSync(
		path.join(ghostHome, "rev-1.envelope.json"),
		JSON.stringify({ type: "intent", identity: "intent/ghost", revision: 1, status: "prepared" }),
	);
	fs.writeFileSync(
		path.join(ghostHome, "journal.jsonl"),
		JSON.stringify({ kind: "prepared", revision: 1 }) + "\n",
	);

	// An aborted attempt: revision 2 of the plan was settled as aborted.
	const planHome = path.join(dir, ".amber", "artifacts", "plans", "plan_login-plan");
	fs.appendFileSync(
		path.join(planHome, "journal.jsonl"),
		JSON.stringify({ kind: "aborted", revision: 2 }) + "\n",
	);

	const graph = buildGovernanceGraph(dir);
	const ids = artifactNodeIds(graph.nodes);
	assert.ok(!ids.includes("intent/intent/ghost@1"), "dangling prepared revision is invisible");
	assert.ok(!ids.includes("plan/plan/login-plan@2"), "aborted revision is invisible");
	assert.deepEqual(ids, [
		"intent/intent/login-bug@1",
		"intent/intent/login-bug@2",
		"plan/plan/login-plan@1",
		"spec/spec/login-spec@1",
		"spec/spec/login-spec@2",
	]);
});

test("a corrupt artifact store fails the rebuild closed — never a partial projection", () => {
	const dir = mkTarget("t05-fail-closed");
	buildLineage(dir);

	// Tamper with a committed Envelope without recomputing its hash.
	const envFile = path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		"intent_login-bug",
		"rev-2.envelope.json",
	);
	const stored = JSON.parse(fs.readFileSync(envFile, "utf8"));
	stored.provenance = { source: "TAMPERED" };
	fs.writeFileSync(envFile, JSON.stringify(stored, null, 2) + "\n", "utf8");

	// The read seam refuses: the whole rebuild fails with the typed artifact
	// corruption code (corrupt revisions are excluded by refusal, never by
	// silent skipping — F035-S5).
	assert.throws(() => listArtifactRevisions(dir), /AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH/);
	assert.throws(() => buildGovernanceGraph(dir), /AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH/);

	const built = rebuildProjection(dir, "governance-graph", governanceGraphBuilder, REBUILD_OPTIONS);
	assert.equal(built.ok, false);
	assert.equal(built.code, "AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH");
	assert.equal(built.manifestPath, null, "nothing is written on a failed rebuild");
	assert.ok(!fs.existsSync(path.join(dir, ".amber", "projections", "governance-graph.json")));
});

// F-5 (ticket-05 review): the missing-half branch of the projection read — a
// committed revision whose Body half is gone fails the whole read closed with
// the settlement corruption code (only the hash-mismatch branch was covered).
test("a committed revision missing its Body half fails the projection read closed", () => {
	const dir = mkTarget("t05-missing-half");
	buildLineage(dir);

	fs.rmSync(path.join(dir, ".amber", "artifacts", "plans", "plan_login-plan", "rev-1.md"));

	assert.throws(() => listArtifactRevisions(dir), /AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT/);
	assert.throws(() => buildGovernanceGraph(dir), /missing its Body on disk/);

	const built = rebuildProjection(dir, "governance-graph", governanceGraphBuilder, REBUILD_OPTIONS);
	assert.equal(built.ok, false);
	assert.equal(built.code, "AMBER_E_ARTIFACT_SETTLEMENT_CORRUPT");
	assert.equal(built.manifestPath, null, "nothing is written on a failed rebuild");
	assert.ok(!fs.existsSync(path.join(dir, ".amber", "projections", "governance-graph.json")));
});

// ── AC 5: bounded queries keep the existing contract ───────────

test("a scoped query on an artifact revision node returns the revision and its trace neighbors", () => {
	const dir = mkTarget("t05-query-scope");
	buildLineage(dir);
	const graph = buildGovernanceGraph(dir);

	// spec@1 refines the accepted intent@2: the scope resolves the node plus
	// its trace neighborhood, nothing more.
	const result = queryGraph(graph, { scope: "spec/spec/login-spec@1" });
	assert.equal(result.ok, true);
	assert.deepEqual(artifactNodeIds(result.nodes), [
		"intent/intent/login-bug@2",
		"spec/spec/login-spec@1",
	]);

	// plan@1 realizes the approved spec@2.
	const planScope = queryGraph(graph, { scope: "plan/plan/login-plan@1" });
	assert.equal(planScope.ok, true);
	assert.deepEqual(artifactNodeIds(planScope.nodes), [
		"plan/plan/login-plan@1",
		"spec/spec/login-spec@2",
	]);

	// An unknown scope is denied, never guessed (exact-scope denial).
	const denied = queryGraph(graph, { scope: "intent/login-bug@2" });
	assert.equal(denied.ok, false, "a partial id is not a node id");
	assert.equal(denied.code, "AMBER_E_GRAPH_DENY");
});

test("an unscoped query over artifact nodes stays bounded with a truncation flag", () => {
	const dir = mkTarget("t05-query-bounded");
	buildLineage(dir);
	const graph = buildGovernanceGraph(dir);
	assert.ok(graph.nodes.length >= 5, "fixture has at least five nodes");

	const bounded = queryGraph(graph, { scope: null, limit: 3 });
	assert.equal(bounded.ok, true);
	assert.equal(bounded.nodes.length, 3, "bounded read");
	assert.equal(bounded.truncated, true, "truncation flagged");

	const full = queryGraph(graph, {});
	assert.equal(full.ok, true);
	assert.equal(full.truncated, false);
	assert.equal(full.nodes.length, graph.nodes.length);
});

// ── F055 P4: deletion tombstones in the artifact layer (rule v3) ─

test("deletion tombstones redact nodes and withhold their outgoing trace edges", () => {
	assert.equal(ARTIFACT_GRAPH_RULE_VERSION, 3, "tombstones are a visible rule change");
	const revision = (type, identity, rev, traces = []) => ({
		type,
		identity,
		revision: rev,
		lifecycle: "draft",
		scope: null,
		supersedes: null,
		contentHash: `sha256:${"a".repeat(64)}`,
		envelopeHash: "b".repeat(64),
		provenance: { source: "test" },
		committedAt: "2026-08-29T00:00:00.000Z",
		traces,
	});
	const revisions = [
		revision("intent", "intent/a", 1),
		revision("spec", "spec/b", 1, [
			{ type: "refines", to: { type: "intent", identity: "intent/a", revision: 1 } },
		]),
		revision("plan", "plan/c", 1, [
			{ type: "realizes", to: { type: "spec", identity: "spec/b", revision: 1 } },
		]),
	];

	const live = artifactGraphLayer(revisions, []);
	assert.ok(
		live.nodes.every((n) => n.tombstone === null),
		"untouched nodes carry tombstone: null",
	);
	assert.equal(live.edges.length, 2);

	const layer = artifactGraphLayer(revisions, [
		{
			record: { type: "spec", identity: "spec/b", revision: 1 },
			transactionId: "tx/1",
			status: "deletion-pending",
		},
	]);
	const tombstoned = layer.nodes.find((n) => n.id === "spec/spec/b@1");
	assert.deepEqual(tombstoned.tombstone, { status: "deletion-pending", transactionId: "tx/1" });
	// Minimal stable identity plus the transaction reference — every
	// content-bearing field is redacted so the projection cannot recreate
	// or fingerprint deleted content.
	assert.equal(tombstoned.artifactType, "spec");
	assert.equal(tombstoned.identity, "spec/b");
	assert.equal(tombstoned.revision, 1);
	assert.equal(tombstoned.lifecycle, null);
	assert.equal(tombstoned.contentHash, null);
	assert.equal(tombstoned.envelopeHash, null);
	assert.equal(tombstoned.provenance, null);
	assert.equal(tombstoned.committedAt, null);
	// The tombstoned revision's own trace edge is withheld; the live plan's
	// edge TOWARD the tombstone survives because it derives from the live
	// revision's committed content.
	assert.deepEqual(
		layer.edges.map((e) => `${e.source} -${e.type}-> ${e.target}`),
		["plan/plan/c@1 -realizes-> spec/spec/b@1"],
	);

	// Deterministic selection when several transactions name one record:
	// a settled deletion beats a pending one, regardless of input order.
	const both = artifactGraphLayer(revisions, [
		{
			record: { type: "spec", identity: "spec/b", revision: 1 },
			transactionId: "tx/2",
			status: "deletion-pending",
		},
		{
			record: { type: "spec", identity: "spec/b", revision: 1 },
			transactionId: "tx/1",
			status: "deleted",
		},
	]);
	assert.deepEqual(both.nodes.find((n) => n.id === "spec/spec/b@1").tombstone, {
		status: "deleted",
		transactionId: "tx/1",
	});
});
