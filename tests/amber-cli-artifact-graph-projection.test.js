"use strict";

// F049 ticket 05 (#222) — Governance Graph projection of Canonical Artifact
// revisions, at the PUBLIC rebuild + query seam: `amber artifact admit`
// builds the committed lineage, `amber projection rebuild --type
// governance-graph` projects it, `amber projection query` reads it back.
// Fixtures cover deterministic rebuilds and projection non-authority.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-t05-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

const INTENT_BODY = "# Intent: fix the login bug\n\nUsers cannot log in.\n";
const SPEC_BODY = "# Spec: login\n\nThe login form must submit.\n";
const PLAN_BODY = "# Plan: login\n\nThree vertical slices.\n";

// The full Intent -> Spec -> Plan planning lineage through the public
// admission seam: five committed revisions with typed traces.
function buildLineage(dir) {
	const steps = [
		["artifact", "admit", "--id", "intent/login-bug", "--body", INTENT_BODY],
		[
			"artifact",
			"admit",
			"--id",
			"intent/login-bug",
			"--body",
			INTENT_BODY,
			"--expected-head",
			"1",
			"--transition",
			"accept",
		],
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/login-spec",
			"--body",
			SPEC_BODY,
			"--trace",
			"refines:intent/login-bug",
		],
		[
			"artifact",
			"admit",
			"--type",
			"spec",
			"--id",
			"spec/login-spec",
			"--body",
			SPEC_BODY,
			"--expected-head",
			"1",
			"--transition",
			"approve",
			"--trace",
			"refines:intent/login-bug",
		],
		[
			"artifact",
			"admit",
			"--type",
			"plan",
			"--id",
			"plan/login-plan",
			"--body",
			PLAN_BODY,
			"--trace",
			"realizes:spec/login-spec",
		],
	];
	for (const args of steps) {
		const r = runCli([...args, "--target", dir, "--json"], dir);
		assert.equal(r.status, 0, `${args.join(" ")}\n${r.stderr}`);
	}
}

function rebuild(dir) {
	return runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
}

// Recursive content snapshot: relative path -> sha256 of file bytes.
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

test("projection rebuild projects committed artifact revisions as nodes with typed trace edges", () => {
	const dir = mkTarget("rebuild");
	buildLineage(dir);

	const r = rebuild(dir);
	assert.equal(r.status, 0, r.stderr);
	const manifest = payload(r);
	assert.equal(manifest.projection_type, "governance-graph");
	assert.match(manifest.rebuild_checkpoint, /^sha256:[0-9a-f]{64}$/);
	assert.match(manifest.outputHash, /^sha256:[0-9a-f]{64}$/);
	assert.deepEqual(manifest.projection_rule_versions, { artifactGraph: 2, traceContract: 1 });
	assert.equal(manifest.schemaVersion, "1.0.0");

	// The durable output carries the graph: one node per committed revision,
	// one typed edge per resolved Trace.
	const output = JSON.parse(
		fs.readFileSync(
			path.join(dir, ".amber", "projections", "governance-graph.output.json"),
			"utf8",
		),
	);
	const nodeIds = output.nodes.map((n) => n.id);
	assert.deepEqual(
		nodeIds.filter((id) => id.includes("@")),
		[
			"intent/intent/login-bug@1",
			"intent/intent/login-bug@2",
			"plan/plan/login-plan@1",
			"spec/spec/login-spec@1",
			"spec/spec/login-spec@2",
		],
	);
	const traceEdges = output.edges
		.filter((e) => ["refines", "realizes", "supersedes"].includes(e.type))
		.map((e) => `${e.source} -${e.type}-> ${e.target}`)
		.sort();
	assert.deepEqual(traceEdges, [
		"plan/plan/login-plan@1 -realizes-> spec/spec/login-spec@2",
		"spec/spec/login-spec@1 -refines-> intent/intent/login-bug@2",
		"spec/spec/login-spec@2 -refines-> intent/intent/login-bug@2",
	]);
});

test("projection rebuild is deterministic at the public seam — same committed state, same result hash", () => {
	const dir = mkTarget("deterministic");
	buildLineage(dir);

	const first = rebuild(dir);
	assert.equal(first.status, 0, first.stderr);
	const second = rebuild(dir);
	assert.equal(second.status, 0, second.stderr);
	const a = payload(first);
	const b = payload(second);
	assert.equal(b.outputHash, a.outputHash, "identical result hash");
	assert.equal(b.rebuild_checkpoint, a.rebuild_checkpoint, "identical source checkpoint");

	// The projection certifies current until a new revision is committed.
	const status = payload(
		runCli(["projection", "status", "--type", "governance-graph", "--target", dir, "--json"], dir),
	);
	assert.equal(status.ok, true, "current right after rebuild");

	const approve = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"plan",
			"--id",
			"plan/login-plan",
			"--body",
			PLAN_BODY,
			"--expected-head",
			"1",
			"--transition",
			"approve",
			"--trace",
			"realizes:spec/login-spec",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(approve.status, 0, approve.stderr);
	const drifted = payload(
		runCli(["projection", "status", "--type", "governance-graph", "--target", dir, "--json"], dir),
	);
	assert.equal(drifted.ok, false, "committed state changed, projection drifts");
	assert.equal(drifted.code, "AMBER_E_PROJECTION_DRIFT");

	const rebuilt = rebuild(dir);
	assert.equal(rebuilt.status, 0, rebuilt.stderr);
	assert.notEqual(
		payload(rebuilt).outputHash,
		a.outputHash,
		"new revision changes the result hash",
	);
	const current = payload(
		runCli(["projection", "status", "--type", "governance-graph", "--target", dir, "--json"], dir),
	);
	assert.equal(current.ok, true, "current again after rebuild");
});

test("projection query resolves an artifact revision node id and its trace neighborhood", () => {
	const dir = mkTarget("query");
	buildLineage(dir);
	assert.equal(rebuild(dir).status, 0);

	const r = runCli(
		["projection", "query", "--scope", "spec/spec/login-spec@2", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.ok, true);
	assert.deepEqual(
		out.nodes.map((n) => n.id),
		["intent/intent/login-bug@2", "plan/plan/login-plan@1", "spec/spec/login-spec@2"],
		"scope resolves the revision plus its refines/realizes neighbors",
	);
	assert.ok(out.receiptId, "every read leaves a receipt");

	// Unknown scope is denied under the existing exact-scope contract.
	const denied = runCli(
		["projection", "query", "--scope", "intent/login-bug@2", "--target", dir, "--json"],
		dir,
	);
	assert.equal(denied.status, 1);
	assert.equal(payload(denied).code, "AMBER_E_GRAPH_DENY");
});

test("projection query stays bounded over artifact revision nodes", () => {
	const dir = mkTarget("bounded");
	buildLineage(dir);

	const r = runCli(["projection", "query", "--limit", "2", "--target", dir, "--json"], dir);
	assert.equal(r.status, 0, r.stderr);
	const out = payload(r);
	assert.equal(out.ok, true);
	assert.ok(out.nodes.length <= 2, "bounded read");
	assert.equal(out.truncated, true, "truncation flagged");
});

// F-5 (ticket-05 review): a `supersedes` Trace must appear in the graph
// output as a typed edge — the third registered Trace type rides the same
// edge `type` field as refines/realizes, resolving to the target head.
test("a supersedes trace appears in the graph output as a typed edge", () => {
	const dir = mkTarget("supersedes");
	const steps = [
		["artifact", "admit", "--id", "intent/old", "--body", "# Intent: old\n"],
		[
			"artifact",
			"admit",
			"--id",
			"intent/new",
			"--body",
			"# Intent: new\n",
			"--trace",
			"supersedes:intent/old",
		],
	];
	for (const args of steps) {
		const r = runCli([...args, "--target", dir, "--json"], dir);
		assert.equal(r.status, 0, `${args.join(" ")}\n${r.stderr}`);
	}

	const r = rebuild(dir);
	assert.equal(r.status, 0, r.stderr);
	const output = JSON.parse(
		fs.readFileSync(
			path.join(dir, ".amber", "projections", "governance-graph.output.json"),
			"utf8",
		),
	);
	assert.deepEqual(
		output.edges
			.filter((e) => e.type === "supersedes")
			.map((e) => `${e.source} -${e.type}-> ${e.target}`),
		["intent/intent/new@1 -supersedes-> intent/intent/old@1"],
		"the supersedes Trace resolves to the target's committed head",
	);

	// The scoped query reaches the successor through the typed edge.
	const q = runCli(
		["projection", "query", "--scope", "intent/intent/new@1", "--target", dir, "--json"],
		dir,
	);
	assert.equal(q.status, 0, q.stderr);
	assert.deepEqual(
		payload(q)
			.nodes.map((n) => n.id)
			.sort(),
		["intent/intent/new@1", "intent/intent/old@1"],
	);
});

test("rebuild and query never write to the Canonical Artifact store (non-authority)", () => {
	const dir = mkTarget("authority");
	buildLineage(dir);

	const artifactsRoot = path.join(dir, ".amber", "artifacts");
	const before = snapshotTree(artifactsRoot);

	assert.equal(rebuild(dir).status, 0);
	assert.equal(
		runCli(
			["projection", "query", "--scope", "spec/spec/login-spec@2", "--target", dir, "--json"],
			dir,
		).status,
		0,
	);
	assert.equal(
		runCli(["projection", "status", "--type", "governance-graph", "--target", dir, "--json"], dir)
			.status,
		0,
	);

	assert.deepEqual(snapshotTree(artifactsRoot), before, "artifact store byte-identical");
	// The projection's own store is where the rebuild landed.
	assert.ok(fs.existsSync(path.join(dir, ".amber", "projections", "governance-graph.json")));
	assert.ok(fs.existsSync(path.join(dir, ".amber", "projections", "governance-graph.output.json")));
});

test("a corrupt artifact store fails rebuild and query closed with the typed code", () => {
	const dir = mkTarget("fail-closed");
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

	const r = rebuild(dir);
	assert.equal(r.status, 1);
	assert.equal(payload(r).code, "AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH");
	assert.ok(
		!fs.existsSync(path.join(dir, ".amber", "projections", "governance-graph.json")),
		"nothing written",
	);

	const q = runCli(["projection", "query", "--target", dir, "--json"], dir);
	assert.equal(q.status, 1);
	assert.equal(
		payload(q).code,
		"AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH",
		"query fails closed too",
	);
});
