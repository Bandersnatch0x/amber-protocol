"use strict";

// F049 ticket 06 (#223) — unit coverage for the Canonical Artifact
// version-negotiation, extension-namespace, and size-ceiling contracts, plus
// the pure trace-cycle walker's iterative conversion (routed finding 2: the
// recursive form overflowed the call stack on a deep linear supersedes chain
// and surfaced as the WRONG error — a raw RangeError, or
// AMBER_E_ARTIFACT_NOT_FOUND from the CLI's fallback).
//
// The store-level read/write seams are exercised through the same public
// module surface the CLI uses (admitArtifact / showArtifact / listArtifacts /
// listArtifactRevisions); hand-crafted stores are produced by admitting
// normally and rewriting the stored Envelope, recomputing its hash when the
// fixture must be self-consistent (and leaving it stale deliberately when the
// test pins check PRECEDENCE — a version problem must report the version
// code, never a hash mismatch).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	ENVELOPE_SCHEMA_VERSION,
	SUPPORTED_ENVELOPE_SCHEMA_VERSIONS,
	ENVELOPE_CORE_FIELDS,
	envelopeVersionProblem,
	envelopeUnknownFieldProblem,
	extensionNamespaceProblem,
} = require("../../scripts/lib/core/canonical-artifact-contracts");
const {
	admitArtifact,
	showArtifact,
	listArtifacts,
	listArtifactRevisions,
	envelopeHash,
} = require("../../scripts/lib/core/canonical-artifacts");
const { findTraceCycle } = require("../../scripts/lib/core/canonical-artifact-verify");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-t06-${label}-`));
}

function homeOf(dir, identity) {
	return path.join(
		dir,
		".amber",
		"artifacts",
		"intents",
		`${identity}`.replace(/[^a-zA-Z0-9._-]+/g, "_"),
	);
}

function journalOf(dir, identity) {
	return path.join(homeOf(dir, identity), "journal.jsonl");
}

function admitIntent(dir, identity, body = "# Intent\n", extra = {}) {
	return admitArtifact(dir, { type: "intent", identity, body, ...extra });
}

function readEnvelopeFile(dir, identity, revision = 1) {
	return JSON.parse(
		fs.readFileSync(path.join(homeOf(dir, identity), `rev-${revision}.envelope.json`), "utf8"),
	);
}

// Rewrite a stored Envelope on disk. `mutate` edits the parsed object;
// `recomputeHash: false` leaves the recorded envelopeHash stale on purpose —
// the read-side version/field/extension checks run BEFORE the hash check, so
// a stale hash must not mask (or masquerade as) the contract verdict.
function rewriteEnvelope(dir, identity, revision, mutate, { recomputeHash = true } = {}) {
	const file = path.join(homeOf(dir, identity), `rev-${revision}.envelope.json`);
	const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
	mutate(envelope);
	if (recomputeHash) envelope.envelopeHash = envelopeHash(envelope);
	fs.writeFileSync(file, JSON.stringify(envelope, null, 2) + "\n", "utf8");
}

// Temporarily set environment variables for one test (restored afterwards).
// The CLI tests in amber-cli-canonical-artifact-versioning.test.js rely on
// spawnSync inheriting this process's environment, so the same variables ride
// to the child processes too.
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

function assertTyped(code, fn, label = "") {
	let thrown = null;
	try {
		fn();
	} catch (err) {
		thrown = err;
	}
	assert.ok(thrown, `expected a typed ${code} failure${label ? ` (${label})` : ""}`);
	assert.equal(
		thrown.amberCode,
		code,
		`expected ${code}${label ? ` (${label})` : ""}, got: ${thrown.message}`,
	);
	return thrown;
}

// ── AC1: version negotiation — pure contract functions ────────

test("envelopeVersionProblem accepts supported and absent schema versions", () => {
	assert.equal(envelopeVersionProblem(null), null);
	assert.equal(envelopeVersionProblem({}), null, "absent schemaVersion reads as the implicit v1");
	assert.equal(envelopeVersionProblem({ schemaVersion: 1 }), null);
	assert.equal(
		envelopeVersionProblem({ schemaVersion: SUPPORTED_ENVELOPE_SCHEMA_VERSIONS.at(-1) }),
		null,
	);
	assert.equal(envelopeVersionProblem({ traceContractVersion: 1 }), null);
	assert.equal(envelopeVersionProblem({ traceContractVersion: undefined }), null);
});

test("envelopeVersionProblem rejects every unsupported schema version with the stable code", () => {
	for (const schemaVersion of [2, 0, -1, 1.5, "1", null, Number.NaN]) {
		const problem = envelopeVersionProblem({ schemaVersion, identity: "intent/x", revision: 1 });
		assert.ok(problem, `schemaVersion ${JSON.stringify(schemaVersion)} must be a problem`);
		assert.equal(problem.code, "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION");
		assert.match(problem.message, /schemaVersion/);
	}
});

test("envelopeVersionProblem rejects an unknown traceContractVersion with the same code", () => {
	for (const traceContractVersion of [2, 0, "1", null]) {
		const problem = envelopeVersionProblem({
			traceContractVersion,
			identity: "intent/x",
			revision: 1,
		});
		assert.ok(problem, `traceContractVersion ${JSON.stringify(traceContractVersion)} is unknown`);
		assert.equal(problem.code, "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION");
		assert.match(problem.message, /traceContractVersion/);
	}
	// The schema version is negotiated first: both wrong names schemaVersion.
	const both = envelopeVersionProblem({
		schemaVersion: 9,
		traceContractVersion: 9,
		identity: "intent/x",
		revision: 1,
	});
	assert.match(both.message, /schemaVersion 9/);
});

test("the Envelope core field set is closed and frozen, with the extensions carrier reserved", () => {
	assert.equal(ENVELOPE_SCHEMA_VERSION, 1);
	assert.deepEqual([...SUPPORTED_ENVELOPE_SCHEMA_VERSIONS], [1]);
	assert.ok(Object.isFrozen(ENVELOPE_CORE_FIELDS));
	assert.deepEqual(
		[...ENVELOPE_CORE_FIELDS],
		[
			"schemaVersion",
			"type",
			"identity",
			"revision",
			"supersedes",
			"bodyHash",
			"lifecycle",
			"transition",
			"scope",
			"traces",
			"traceContractVersion",
			"provenance",
			"committedAt",
			"envelopeHash",
			"extensions",
			// F050 #226: the Decision binding is canonical Envelope content;
			// non-decision Envelopes carry both fields as null.
			"decisionKind",
			"principal",
		],
	);
});

test("envelopeUnknownFieldProblem reports unknown top-level fields, sorted, never silently", () => {
	const core = {};
	for (const field of ENVELOPE_CORE_FIELDS) core[field] = null;
	assert.equal(envelopeUnknownFieldProblem(core), null);
	assert.equal(envelopeUnknownFieldProblem({}), null);

	const one = envelopeUnknownFieldProblem({ flavor: "x", identity: "intent/x", revision: 1 });
	assert.equal(one.code, "AMBER_E_ARTIFACT_UNKNOWN_FIELD");
	assert.match(one.message, /"flavor"/);

	const plural = envelopeUnknownFieldProblem({
		zebra: 1,
		alpha: 2,
		identity: "intent/x",
		revision: 1,
	});
	assert.equal(plural.code, "AMBER_E_ARTIFACT_UNKNOWN_FIELD");
	assert.match(plural.message, /"alpha", "zebra"/, "unknown fields are reported in sorted order");
});

// ── AC2: extension namespace contract — pure contract function ─

test("extensionNamespaceProblem accepts valid, opaque namespace data", () => {
	assert.equal(extensionNamespaceProblem(null), null);
	assert.equal(extensionNamespaceProblem(undefined), null);
	assert.equal(extensionNamespaceProblem({}), null);
	assert.equal(extensionNamespaceProblem({ acme: {} }), null);
	assert.equal(
		extensionNamespaceProblem({
			acme: { weight: 3, meta: { a: [1, 2] }, tag: "plain-string", none: null },
			"other-ns": { nested: { deep: true } },
		}),
		null,
		"unregistered namespaces are carried opaquely",
	);
});

test("extensionNamespaceProblem rejects namespace and key collisions with core fields", () => {
	const namespace = extensionNamespaceProblem({ type: { x: 1 } });
	assert.equal(namespace.code, "AMBER_E_ARTIFACT_EXTENSION_COLLISION");
	assert.match(namespace.message, /namespace "type"/);

	const key = extensionNamespaceProblem({ acme: { identity: 1 } });
	assert.equal(key.code, "AMBER_E_ARTIFACT_EXTENSION_COLLISION");
	assert.match(key.message, /"acme\.identity"/);

	for (const coreField of ["type", "identity", "traces", "envelopeHash", "schemaVersion"]) {
		assert.ok(extensionNamespaceProblem({ [coreField]: { x: 1 } }), `namespace ${coreField}`);
		assert.ok(extensionNamespaceProblem({ acme: { [coreField]: 1 } }), `key ${coreField}`);
	}
});

test("extensionNamespaceProblem rejects malformed carriers and non-JSON values", () => {
	for (const carrier of ["nope", 42, [1, 2]]) {
		const problem = extensionNamespaceProblem(carrier);
		assert.ok(problem, `carrier ${JSON.stringify(carrier)}`);
		assert.equal(problem.code, "AMBER_E_ARTIFACT_EXTENSION_COLLISION");
	}
	const emptyNamespace = extensionNamespaceProblem({ "": { x: 1 } });
	assert.equal(emptyNamespace.code, "AMBER_E_ARTIFACT_EXTENSION_COLLISION");

	const notAnObject = extensionNamespaceProblem({ acme: "scalar" });
	assert.equal(notAnObject.code, "AMBER_E_ARTIFACT_EXTENSION_COLLISION");

	const nonJson = extensionNamespaceProblem({ acme: { bad: BigInt(7) } });
	assert.equal(nonJson.code, "AMBER_E_ARTIFACT_EXTENSION_COLLISION");
	assert.match(nonJson.message, /not JSON-serializable/);
});

// ── AC1: version negotiation — writer seam ─────────────────────

test("admission refuses an unsupported schemaVersion before any durable state exists", () => {
	for (const schemaVersion of [2, "1", 1.5]) {
		const dir = mkTarget("writer-v2");
		const result = admitIntent(dir, "intent/a", "# A\n", { schemaVersion });
		assert.equal(result.ok, false, `schemaVersion ${JSON.stringify(schemaVersion)}`);
		assert.equal(result.code, "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION");
		assert.ok(!fs.existsSync(path.join(dir, ".amber")), "no durable state was touched");
	}
});

test("admission of a supported schemaVersion works and records it on the Envelope", () => {
	const dir = mkTarget("writer-v1");
	const result = admitIntent(dir, "intent/a", "# A\n", { schemaVersion: 1 });
	assert.equal(result.ok, true, result.errors?.join("; "));
	assert.equal(readEnvelopeFile(dir, "intent/a").schemaVersion, 1);
});

// ── AC2: extension namespaces — writer seam ────────────────────

test("admission carries extension namespaces opaquely and echoes them in the receipt", () => {
	const dir = mkTarget("ext-admit");
	const extensions = { acme: { weight: 3, meta: { a: 1 }, tag: "plain-string" } };
	const result = admitIntent(dir, "intent/a", "# A\n", { extensions });
	assert.equal(result.ok, true, result.errors?.join("; "));
	assert.deepEqual(result.receipt.extensions, extensions);

	const stored = readEnvelopeFile(dir, "intent/a");
	assert.deepEqual(stored.extensions, extensions, "carried inside the reserved carrier");

	const shown = showArtifact(dir, "intent/a");
	assert.deepEqual(shown.envelope.extensions, extensions);
	// Core semantics are unaltered by extension data (AC2c).
	assert.equal(shown.envelope.type, "intent");
	assert.equal(shown.lifecycle, "draft");
	assert.equal(shown.envelope.bodyHash, result.receipt.contentHash);
});

test("extensions are canonical content, bound into admission idempotency", () => {
	const dir = mkTarget("ext-idem");
	const extensions = { acme: { weight: 3 } };
	assert.equal(admitIntent(dir, "intent/a", "# A\n", { extensions }).ok, true);

	// A verbatim retry returns the original revision...
	const retry = admitIntent(dir, "intent/a", "# A\n", { extensions });
	assert.equal(retry.ok, true, retry.errors?.join("; "));
	assert.equal(retry.duplicate, true);
	assert.equal(retry.receipt.revision, 1);

	// ...while the same Body with DIFFERENT extension data is a different
	// admission, never a silent duplicate.
	const divergent = admitIntent(dir, "intent/a", "# A\n", {
		extensions: { acme: { weight: 4 } },
	});
	assert.equal(divergent.ok, false);
	assert.equal(divergent.code, "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT");

	// New revision legitimately changes extension data under an expected head.
	const rev2 = admitIntent(dir, "intent/a", "# A v2\n", {
		expectedHead: 1,
		extensions: { acme: { weight: 4 } },
	});
	assert.equal(rev2.ok, true, rev2.errors?.join("; "));
	assert.deepEqual(rev2.receipt.extensions, { acme: { weight: 4 } });
});

test("extensions are hash-covered: editing a stored value breaks the envelopeHash", () => {
	const dir = mkTarget("ext-hash");
	assert.equal(
		admitIntent(dir, "intent/a", "# A\n", { extensions: { acme: { weight: 3 } } }).ok,
		true,
	);
	rewriteEnvelope(
		dir,
		"intent/a",
		1,
		(env) => {
			env.extensions.acme.weight = 999;
		},
		{ recomputeHash: false },
	);
	assertTyped("AMBER_E_ARTIFACT_ENVELOPE_HASH_MISMATCH", () => showArtifact(dir, "intent/a"));
});

test("admission rejects an extensions carrier that violates the namespace contract", () => {
	for (const [label, extensions] of [
		["namespace collision", { type: { x: 1 } }],
		["key collision", { acme: { identity: 1 } }],
		["non-object carrier", "nope"],
		["array carrier", [{ x: 1 }]],
		["non-JSON value", { acme: { bad: BigInt(1) } }],
	]) {
		const dir = mkTarget(`ext-reject-${label.replace(/\W+/g, "-")}`);
		const result = admitIntent(dir, "intent/a", "# A\n", { extensions });
		assert.equal(result.ok, false, label);
		assert.equal(result.code, "AMBER_E_ARTIFACT_EXTENSION_COLLISION", label);
		assert.ok(!fs.existsSync(path.join(dir, ".amber")), `${label}: no durable state`);
	}
});

// ── AC3: admission size ceilings ───────────────────────────────

test("the default Body ceiling (512 KiB) refuses an oversized Body before any state exists", () => {
	const dir = mkTarget("body-default-ceiling");
	const result = admitIntent(dir, "intent/a", "a".repeat(512 * 1024 + 1));
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_ARTIFACT_SIZE_CEILING");
	assert.match(result.errors[0], /AMBER_ARTIFACT_MAX_BODY_BYTES/);
	assert.ok(
		!fs.existsSync(path.join(dir, ".amber")),
		"an oversized artifact never reaches the journal",
	);
});

test("a Body exactly at the default ceiling admits (the bound is inclusive)", () => {
	const dir = mkTarget("body-default-boundary");
	const result = admitIntent(dir, "intent/a", "a".repeat(512 * 1024));
	assert.equal(result.ok, true, result.errors?.join("; "));
	assert.equal(result.receipt.revision, 1);
});

test("AMBER_ARTIFACT_MAX_BODY_BYTES overrides the Body ceiling in both directions", (t) => {
	withEnv(t, { AMBER_ARTIFACT_MAX_BODY_BYTES: "10" });

	const refused = mkTarget("body-env-refuse");
	const over = admitIntent(refused, "intent/a", "0123456789A"); // 11 bytes
	assert.equal(over.ok, false);
	assert.equal(over.code, "AMBER_E_ARTIFACT_SIZE_CEILING");
	assert.ok(!fs.existsSync(path.join(refused, ".amber")));

	const boundary = mkTarget("body-env-boundary");
	const exact = admitIntent(boundary, "intent/a", "0123456789"); // exactly 10
	assert.equal(exact.ok, true, exact.errors?.join("; "));
});

test("the Envelope ceiling bounds the serialized Envelope before the journal is appended", () => {
	const dir = mkTarget("envelope-default-ceiling");
	const result = admitIntent(dir, "intent/a", "# A\n", {
		provenance: { source: "x".repeat(300 * 1024) },
	});
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_ARTIFACT_SIZE_CEILING");
	assert.match(result.errors[0], /AMBER_ARTIFACT_MAX_ENVELOPE_BYTES/);
	// The lock may have created the (empty) home; nothing durable may remain:
	// no journal, no revision pair.
	assert.ok(!fs.existsSync(journalOf(dir, "intent/a")), "never reaches the journal");
	assert.ok(!fs.existsSync(homeOf(dir, "intent/a")), "the empty home was cleaned up");
});

test("AMBER_ARTIFACT_MAX_ENVELOPE_BYTES overrides the Envelope ceiling in both directions", () => {
	const key = "AMBER_ARTIFACT_MAX_ENVELOPE_BYTES";
	const saved = process.env[key];
	try {
		// Raising the ceiling admits an Envelope the default would refuse.
		process.env[key] = String(400 * 1024);
		const raised = mkTarget("envelope-env-raise");
		const ok = admitIntent(raised, "intent/a", "# A\n", {
			provenance: { source: "x".repeat(300 * 1024) },
		});
		assert.equal(ok.ok, true, ok.errors?.join("; "));

		// Lowering it refuses an ordinary small Envelope.
		process.env[key] = "100";
		const lowered = mkTarget("envelope-env-lower");
		const refused = admitIntent(lowered, "intent/a", "# A\n");
		assert.equal(refused.ok, false);
		assert.equal(refused.code, "AMBER_E_ARTIFACT_SIZE_CEILING");
		assert.ok(!fs.existsSync(journalOf(lowered, "intent/a")));
	} finally {
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
});

test("a garbage ceiling override fails closed as an argument error, never a silent default", () => {
	const keys = ["AMBER_ARTIFACT_MAX_BODY_BYTES", "AMBER_ARTIFACT_MAX_ENVELOPE_BYTES"];
	const saved = keys.map((key) => [key, process.env[key]]);
	try {
		for (const name of keys) {
			for (const key of keys) delete process.env[key];
			process.env[name] = "banana";
			const dir = mkTarget(`garbage-${name}`);
			const result = admitIntent(dir, "intent/a", "# A\n");
			assert.equal(result.ok, false, name);
			assert.equal(result.code, "AMBER_E_INVALID_ARG", name);
			assert.match(result.errors[0], new RegExp(name));
			assert.ok(!fs.existsSync(path.join(dir, ".amber")), name);
		}
	} finally {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

// ── AC1/AC2: read seam — stored envelopes ──────────────────────

test("a stored schemaVersion-2 Envelope fails every read seam with the stable code", () => {
	// Self-consistent fixture (hash recomputed): the verdict is purely the
	// version negotiation, not a broken binding.
	const dir = mkTarget("v2-read");
	assert.equal(admitIntent(dir, "intent/a").ok, true);
	rewriteEnvelope(dir, "intent/a", 1, (env) => {
		env.schemaVersion = 2;
	});
	assertTyped("AMBER_E_ARTIFACT_UNSUPPORTED_VERSION", () => showArtifact(dir, "intent/a"));
	assertTyped("AMBER_E_ARTIFACT_UNSUPPORTED_VERSION", () => listArtifacts(dir));
	assertTyped("AMBER_E_ARTIFACT_UNSUPPORTED_VERSION", () => listArtifactRevisions(dir));
});

test("the version check precedes the hash check — a stale hash never masks the version verdict", () => {
	const dir = mkTarget("v2-stale-hash");
	assert.equal(admitIntent(dir, "intent/a").ok, true);
	rewriteEnvelope(
		dir,
		"intent/a",
		1,
		(env) => {
			env.schemaVersion = 2;
		},
		{ recomputeHash: false },
	);
	assertTyped("AMBER_E_ARTIFACT_UNSUPPORTED_VERSION", () => showArtifact(dir, "intent/a"));
	assertTyped("AMBER_E_ARTIFACT_UNSUPPORTED_VERSION", () => listArtifacts(dir));
});

test("a stored unknown traceContractVersion fails reads with the stable version code", () => {
	const dir = mkTarget("trace-v2");
	assert.equal(admitIntent(dir, "intent/a").ok, true);
	rewriteEnvelope(dir, "intent/a", 1, (env) => {
		env.traceContractVersion = 2;
	});
	assertTyped("AMBER_E_ARTIFACT_UNSUPPORTED_VERSION", () => showArtifact(dir, "intent/a"));
	assertTyped("AMBER_E_ARTIFACT_UNSUPPORTED_VERSION", () => listArtifactRevisions(dir));
});

test("a stored unknown top-level field fails reads with the stable unknown-field code", () => {
	const dir = mkTarget("unknown-field");
	assert.equal(admitIntent(dir, "intent/a").ok, true);
	rewriteEnvelope(
		dir,
		"intent/a",
		1,
		(env) => {
			env.flavor = "sourdough";
			env.zebra = 1;
			env.alpha = 2;
		},
		{ recomputeHash: false },
	);
	const err = assertTyped("AMBER_E_ARTIFACT_UNKNOWN_FIELD", () => showArtifact(dir, "intent/a"));
	assert.match(err.message, /"alpha", "flavor", "zebra"/, "sorted, nothing silently dropped");
	assertTyped("AMBER_E_ARTIFACT_UNKNOWN_FIELD", () => listArtifacts(dir));
	assertTyped("AMBER_E_ARTIFACT_UNKNOWN_FIELD", () => listArtifactRevisions(dir));
});

test("a legacy Envelope without schemaVersion still reads (implicit version 1)", () => {
	const dir = mkTarget("legacy-implicit-v1");
	assert.equal(admitIntent(dir, "intent/a", "# legacy\n").ok, true);
	rewriteEnvelope(dir, "intent/a", 1, (env) => {
		delete env.schemaVersion;
	});
	const shown = showArtifact(dir, "intent/a");
	assert.equal(shown.body, "# legacy\n");
	assert.equal(shown.revision, 1);
	assert.equal(listArtifacts(dir).length, 1);
});

test("a stored extensions carrier that violates the namespace contract fails reads", () => {
	for (const [label, mutate] of [
		[
			"namespace collision",
			(env) => {
				env.extensions = { type: { x: 1 } };
			},
		],
		[
			"key collision",
			(env) => {
				env.extensions = { acme: { identity: 1 } };
			},
		],
		[
			"non-object carrier",
			(env) => {
				env.extensions = "nope";
			},
		],
	]) {
		const dir = mkTarget(`ext-read-${label.replace(/\W+/g, "-")}`);
		assert.equal(admitIntent(dir, "intent/a").ok, true);
		rewriteEnvelope(dir, "intent/a", 1, mutate);
		assertTyped("AMBER_E_ARTIFACT_EXTENSION_COLLISION", () => showArtifact(dir, "intent/a"), label);
		assertTyped("AMBER_E_ARTIFACT_EXTENSION_COLLISION", () => listArtifacts(dir), label);
		assertTyped("AMBER_E_ARTIFACT_EXTENSION_COLLISION", () => listArtifactRevisions(dir), label);
	}
});

test("a stored unsupported-version head blocks new admission with the same verdict", () => {
	const dir = mkTarget("v2-blocks-admission");
	assert.equal(admitIntent(dir, "intent/a", "# A\n").ok, true);
	rewriteEnvelope(dir, "intent/a", 1, (env) => {
		env.schemaVersion = 2;
	});

	// Building on the head validates the stored head through the same
	// committedProjection choke point — the admission verdict matches the
	// read verdict (deterministic negotiation at every seam).
	const build = admitIntent(dir, "intent/a", "# B\n", { expectedHead: 1 });
	assert.equal(build.ok, false);
	assert.equal(build.code, "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION");

	// A retry of the original Body (no expected head) never reaches head
	// validation: the same-Body guard fires first — the stored Envelope's
	// canonical content genuinely differs (it declares schemaVersion 2), so
	// the fail-closed idempotency verdict is the honest one.
	const retry = admitIntent(dir, "intent/a", "# A\n");
	assert.equal(retry.ok, false);
	assert.equal(retry.code, "AMBER_E_ARTIFACT_IDEMPOTENCY_CONFLICT");
});

// ── Routed finding 2: iterative trace-cycle walk ───────────────

// Node keying mirrors the walker's: distinct (type, identity, revision)
// triples, or every node would collapse onto one key.
function chainNode(i) {
	return { type: "intent", identity: `deep-${i}`, revision: 1 };
}

test("findTraceCycle walks a 50,000-node linear supersedes chain without recursion", () => {
	const depth = 50_000;
	const nodes = Array.from({ length: depth }, (_, i) => chainNode(i));
	const edgesOf = (node) => {
		const i = Number.parseInt(node.identity.slice(5), 10);
		return i + 1 < depth ? [nodes[i + 1]] : [];
	};
	// The recursive predecessor overflowed the call stack near depth 4,782 on
	// the reference stack; 50,000 pins the iterative conversion with margin.
	// A deep but VALID lineage is walked to completion (null), never a
	// RangeError and never a misreported cycle.
	assert.equal(findTraceCycle([nodes[0]], edgesOf), null);
	assert.equal(findTraceCycle(nodes, edgesOf), null, "many starts share the walk's coloring");
});

test("findTraceCycle still reports a cycle planted at the far end of a 20,000-node chain", () => {
	const depth = 20_000;
	const nodes = Array.from({ length: depth }, (_, i) => chainNode(i));
	const edgesOf = (node) => {
		const i = Number.parseInt(node.identity.slice(5), 10);
		if (i === depth - 1) return [nodes[depth - 2]]; // back edge closes the loop
		return i + 1 < depth ? [nodes[i + 1]] : [];
	};
	const cycle = findTraceCycle([nodes[0]], edgesOf);
	assert.ok(cycle, "the far-end back edge is a cycle");
	assert.deepEqual(cycle, [nodes[depth - 2], nodes[depth - 1], nodes[depth - 2]]);
});

test("findTraceCycle preserves the recursive form's semantics on small graphs", () => {
	const n = (id) => ({ type: "intent", identity: id, revision: 1 });
	const a = n("a");
	const b = n("b");
	const c = n("c");
	const d = n("d");
	const edges = (node) => {
		if (node === a) return [b, c];
		if (node === b) return [d];
		if (node === c) return [d];
		if (node === d) return [];
		if (node.identity === "self") return [node];
		if (node.identity === "black-first") return [];
		return [];
	};
	// Diamond (shared descendant, no cycle) — d is reached twice via white and
	// then black, and stays acyclic.
	assert.equal(findTraceCycle([a], edges), null);
	// A black node revisited from a second start is skipped, not a cycle.
	const start2 = n("second");
	const edgesWithSecond = (node) =>
		node === start2
			? [d]
			: node === d
				? []
				: node === a
					? [b, c]
					: node === b || node === c
						? [d]
						: [];
	findTraceCycle([a], edgesWithSecond);
	assert.equal(findTraceCycle([a, start2], edgesWithSecond), null);
	// Self-loop is the shortest possible cycle.
	const self = n("self");
	assert.deepEqual(findTraceCycle([self], edges), [self, self]);
	// Two-node cycle.
	const p = n("p");
	const q = n("q");
	assert.deepEqual(
		findTraceCycle([p], (node) => (node === p ? [q] : [p])),
		[p, q, p],
	);
});
