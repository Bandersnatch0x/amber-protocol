"use strict";

// F049 ticket 06 (#223) — public CLI seam coverage for version negotiation,
// extension namespaces, size ceilings, and projection resource ceilings:
// `amber artifact admit/show/list` and `amber projection rebuild/query`,
// always asserted through the JSON result envelope with the stable code.
// The deep supersedes-chain fixture (routed finding 2) proves show/list/
// rebuild over a store deeper than the former recursive walker's stack.
//
// runCli spawns without an env option, so children inherit this process's
// environment — the ceiling tests set process.env before spawning (the same
// mechanism operators use to override the defaults).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");
const { admitArtifact, envelopeHash } = require("../scripts/lib/core/canonical-artifacts");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		// Node's default maxBuffer is 1 MiB; the deep-chain fixture's
		// `artifact list` prints every Envelope (~7.3 MiB for 5,000
		// artifacts), which would kill the child mid-stream (status null,
		// ENOBUFS) and masquerade as a CLI crash. This suite's contract is
		// crash-freedom of the read paths, not output-size discipline, so
		// the harness reads the whole stream.
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-t06-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function withEnv(t, overrides) {
	const entries = Object.entries(overrides ?? {});
	const saved = entries.map(([key]) => [key, process.env[key]]);
	for (const [key, value] of entries) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	t.after(() => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

function admitIntentCli(dir, id, body, extra = []) {
	return runCli(
		["artifact", "admit", "--id", id, "--body", body, ...extra, "--target", dir, "--json"],
		dir,
	);
}

function projectionsDir(dir) {
	return path.join(dir, ".amber", "projections");
}

const EXTENSIONS = { acme: { weight: 3, tag: "plain-string", meta: { a: 1 } } };

// ── AC2: --extension flags through the public admit/show seams ─

test("artifact admit carries --extension namespaces opaquely into the receipt and show", () => {
	const dir = mkTarget("ext-flags");
	const r = admitIntentCli(dir, "intent/a", "# A\n", [
		"--extension",
		"acme.weight=3",
		"--extension",
		"acme.tag=plain-string",
		"--extension",
		'acme.meta={"a":1}',
	]);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(payload(r).extensions, EXTENSIONS, "receipt echoes the namespaces");
	// Core semantics untouched by extension data.
	assert.equal(payload(r).lifecycle, "draft");
	assert.equal(payload(r).type, "intent");

	const shown = runCli(["artifact", "show", "--id", "intent/a", "--target", dir, "--json"], dir);
	assert.equal(shown.status, 0, shown.stderr);
	assert.deepEqual(payload(shown).envelope.extensions, EXTENSIONS);

	const listed = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(listed.status, 0, listed.stderr);
	assert.deepEqual(payload(listed)[0].envelope.extensions, EXTENSIONS);
});

test("an extension namespace or key colliding with a core Envelope field fails closed via CLI", () => {
	for (const [label, flag] of [
		["namespace-collision", "type.x=1"],
		["key-collision", "acme.identity=1"],
	]) {
		const dir = mkTarget(`ext-collision-${label}`);
		const r = admitIntentCli(dir, "intent/a", "# A\n", ["--extension", flag]);
		assert.equal(r.status, 1, label);
		assert.equal(payload(r).code, "AMBER_E_ARTIFACT_EXTENSION_COLLISION", label);
		assert.ok(!fs.existsSync(path.join(dir, ".amber")), `${label}: no store was created`);
	}
});

test("malformed --extension values fail closed as argument errors", () => {
	const cases = [
		["missing =", "noequalsign"],
		["missing .", "nodot=1"],
		["duplicate key", null], // handled below with two flags
		["trailing flag", null], // --extension as the last token
	];
	for (const [label, flag] of cases) {
		const dir = mkTarget(`ext-malformed-${label.replace(/\W+/g, "-")}`);
		let r;
		if (label === "duplicate key") {
			r = admitIntentCli(dir, "intent/a", "# A\n", [
				"--extension",
				"acme.k=1",
				"--extension",
				"acme.k=2",
			]);
		} else if (label === "trailing flag") {
			r = runCli(
				[
					"artifact",
					"admit",
					"--id",
					"intent/a",
					"--body",
					"# A\n",
					"--target",
					dir,
					"--json",
					"--extension",
				],
				dir,
			);
		} else {
			r = admitIntentCli(dir, "intent/a", "# A\n", ["--extension", flag]);
		}
		assert.equal(r.status, 1, label);
		assert.equal(payload(r).code, "AMBER_E_INVALID_ARG", label);
		assert.ok(!fs.existsSync(path.join(dir, ".amber")), `${label}: no store was created`);
	}
});

// ── AC3: admission size ceilings through the env overrides ─────

test("an oversized Body is refused at admission and never reaches the journal", (t) => {
	withEnv(t, { AMBER_ARTIFACT_MAX_BODY_BYTES: "8" });
	const dir = mkTarget("body-ceiling-cli");
	const r = admitIntentCli(dir, "intent/a", "# ten chars");
	assert.equal(r.status, 1, r.stderr);
	assert.equal(payload(r).code, "AMBER_E_ARTIFACT_SIZE_CEILING");
	assert.match(payload(r).errors[0], /AMBER_ARTIFACT_MAX_BODY_BYTES/);
	assert.ok(
		!fs.existsSync(path.join(dir, ".amber")),
		"an oversized artifact never reaches the journal",
	);

	// Exactly at the lowered bound: the ceiling is inclusive, not off-by-one.
	const boundary = mkTarget("body-ceiling-boundary-cli");
	const exact = admitIntentCli(boundary, "intent/a", "01234567");
	assert.equal(exact.status, 0, exact.stderr);
});

test("a garbage ceiling override fails closed as AMBER_E_INVALID_ARG via CLI", () => {
	const keys = ["AMBER_ARTIFACT_MAX_BODY_BYTES", "AMBER_ARTIFACT_MAX_ENVELOPE_BYTES"];
	const saved = keys.map((key) => [key, process.env[key]]);
	try {
		for (const name of keys) {
			for (const key of keys) delete process.env[key];
			process.env[name] = "banana";
			const dir = mkTarget(`garbage-cli-${name}`);
			const r = admitIntentCli(dir, "intent/a", "# A\n");
			assert.equal(r.status, 1, name);
			assert.equal(payload(r).code, "AMBER_E_INVALID_ARG", name);
		}
	} finally {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

// ── AC1: version negotiation through the public read seams ─────

test("a stored schemaVersion-2 Envelope fails show, list, and projection rebuild with the stable code", () => {
	const dir = mkTarget("v2-read-cli");
	assert.equal(admitIntentCli(dir, "intent/a", "# A\n").status, 0);

	// Self-consistent fixture: recompute the envelopeHash so the failure is
	// purely the version negotiation, never a broken binding.
	const envFile = path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		"intent_a",
		"rev-1.envelope.json",
	);
	const envelope = JSON.parse(fs.readFileSync(envFile, "utf8"));
	envelope.schemaVersion = 2;
	envelope.envelopeHash = envelopeHash(envelope);
	fs.writeFileSync(envFile, JSON.stringify(envelope, null, 2) + "\n", "utf8");

	const shown = runCli(["artifact", "show", "--id", "intent/a", "--target", dir, "--json"], dir);
	assert.equal(shown.status, 1);
	assert.equal(payload(shown).code, "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION");

	const listed = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(listed.status, 1);
	assert.equal(payload(listed).code, "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION");

	const rebuilt = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(rebuilt.status, 1);
	assert.equal(payload(rebuilt).code, "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION");
	assert.ok(!fs.existsSync(projectionsDir(dir)), "no partial projection was written");
});

// ── AC4: projection resource ceilings, never a truncated success ─

test("projection rebuild refuses a graph over its node ceiling and writes nothing", (t) => {
	withEnv(t, { AMBER_PROJECTION_MAX_NODES: "1" });
	const dir = mkTarget("node-ceiling-cli");
	assert.equal(admitIntentCli(dir, "intent/a", "# A\n").status, 0);
	assert.equal(admitIntentCli(dir, "intent/b", "# B\n").status, 0); // 2 nodes

	const r = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1, r.stderr);
	assert.equal(payload(r).code, "AMBER_E_PROJECTION_RESOURCE_CEILING");
	assert.match(payload(r).errors[0], /node ceiling of 1/);
	assert.ok(
		!fs.existsSync(projectionsDir(dir)),
		"a refused projection is never a truncated success on disk",
	);

	// query builds the graph first and fails the same way.
	const q = runCli(["projection", "query", "--target", dir, "--json"], dir);
	assert.equal(q.status, 1, q.stderr);
	assert.equal(payload(q).code, "AMBER_E_PROJECTION_RESOURCE_CEILING");
});

test("projection rebuild refuses a graph over its edge ceiling", (t) => {
	withEnv(t, { AMBER_PROJECTION_MAX_EDGES: "1" });
	const dir = mkTarget("edge-ceiling-cli");
	// Three intents in a supersedes chain: 3 nodes, 2 typed edges.
	assert.equal(admitIntentCli(dir, "intent/a", "# A\n").status, 0);
	assert.equal(
		admitIntentCli(dir, "intent/b", "# B\n", ["--trace", "supersedes:intent/a"]).status,
		0,
	);
	assert.equal(
		admitIntentCli(dir, "intent/c", "# C\n", ["--trace", "supersedes:intent/b"]).status,
		0,
	);

	const r = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1, r.stderr);
	assert.equal(payload(r).code, "AMBER_E_PROJECTION_RESOURCE_CEILING");
	assert.match(payload(r).errors[0], /edge ceiling of 1/);
	assert.ok(!fs.existsSync(projectionsDir(dir)), "nothing written");
});

test("the same store rebuilds and queries cleanly without the ceiling overrides", () => {
	const dir = mkTarget("no-ceiling-cli");
	assert.equal(admitIntentCli(dir, "intent/a", "# A\n").status, 0);
	assert.equal(
		admitIntentCli(dir, "intent/b", "# B\n", ["--trace", "supersedes:intent/a"]).status,
		0,
	);

	const rebuilt = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(rebuilt.status, 0, rebuilt.stderr);
	assert.equal(payload(rebuilt).projection_type, "governance-graph");

	const queried = runCli(
		["projection", "query", "--scope", "intent/intent/b@1", "--target", dir, "--json"],
		dir,
	);
	assert.equal(queried.status, 0, queried.stderr);
	assert.equal(payload(queried).ok, true);
	assert.deepEqual(
		payload(queried)
			.nodes.map((n) => n.id)
			.sort(),
		["intent/intent/a@1", "intent/intent/b@1"],
	);
});

test("a garbage projection ceiling override fails closed as AMBER_E_INVALID_ARG via CLI", (t) => {
	withEnv(t, { AMBER_PROJECTION_MAX_NODES: "banana" });
	const dir = mkTarget("garbage-projection-cli");
	assert.equal(admitIntentCli(dir, "intent/a", "# A\n").status, 0);
	const r = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(r.status, 1, r.stderr);
	assert.equal(payload(r).code, "AMBER_E_INVALID_ARG");
});

// ── Routed finding 2: deep supersedes chain at the real seams ──
//
// Depth 5,000 sits above the ~4,782 depth at which the former RECURSIVE
// walker overflowed the call stack on the reference stack (measured before
// the fix: a 10k chain made `artifact show` die with a raw RangeError). The
// chain is built through the public admission API (one spawn per artifact
// would cost minutes; the ticket grants judgment on construction strategy —
// the store on disk is identical either way), then read ONLY through the CLI:
// show, list, and rebuild must each exit 0 with a well-formed JSON envelope,
// never a bare RangeError, never AMBER_E_ARTIFACT_NOT_FOUND for a
// deep-but-valid lineage, never a dying list without output.
test("a 5,000-deep linear supersedes chain never kills show, list, or rebuild", () => {
	const dir = mkTarget("deep-chain-cli");
	const depth = 5_000;
	for (let i = 0; i < depth; i += 1) {
		const result = admitArtifact(dir, {
			type: "intent",
			identity: `chain-${i}`,
			body: `# Intent: chain-${i}\n`,
			traces: i > 0 ? [{ type: "supersedes", to: { identity: `chain-${i - 1}` } }] : [],
		});
		assert.ok(result.ok, `admit chain-${i}: ${(result.errors || []).join("; ")}`);
	}

	const shown = runCli(
		["artifact", "show", "--id", `chain-${depth - 1}`, "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 0, shown.stderr);
	assert.equal(payload(shown).identity, `chain-${depth - 1}`);
	assert.equal(payload(shown).traces[0].to.identity, `chain-${depth - 2}`);

	const listed = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(listed.status, 0, listed.stderr);
	assert.equal(payload(listed).length, depth, "the whole store lists, nothing dropped");

	const rebuilt = runCli(
		["projection", "rebuild", "--type", "governance-graph", "--target", dir, "--json"],
		dir,
	);
	assert.equal(rebuilt.status, 0, rebuilt.stderr);
	const manifest = payload(rebuilt);
	assert.equal(manifest.projection_type, "governance-graph");
	assert.match(manifest.rebuild_checkpoint, /^sha256:[0-9a-f]{64}$/);

	const output = JSON.parse(
		fs.readFileSync(path.join(projectionsDir(dir), "governance-graph.output.json"), "utf8"),
	);
	assert.equal(output.nodes.length, depth, "every committed revision projects");
	assert.equal(
		output.edges.filter((e) => e.type === "supersedes").length,
		depth - 1,
		"every supersedes trace is a typed edge",
	);
});
