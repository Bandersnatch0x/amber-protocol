"use strict";

// F050 ticket 6 (#231) — strict query and staleness propagation unit seam.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const {
	governanceGraphSource,
	governanceGraphCheckpoint,
} = require("../../scripts/lib/core/governance-graph");
const {
	recordInvalidation,
	listInvalidations,
	ledgerPath,
} = require("../../scripts/lib/core/staleness-registry");
const { strictGovernanceGraphQuery } = require("../../scripts/lib/core/strict-query");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-strict-query-${label}-`));
}

function admitIntent(dir, identity) {
	const result = admitArtifact(dir, {
		type: "intent",
		identity,
		body: `# Intent ${identity}`,
	});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	return result.receipt;
}

function checkpointOf(dir) {
	return governanceGraphCheckpoint(governanceGraphSource(dir));
}

test("strict query binds exact scope, checkpoint, projection version, limit, sort, and depth", () => {
	const dir = mkTarget("pass");
	admitIntent(dir, "intent/login");
	const scope = "intent/intent/login@1";
	const checkpoint = checkpointOf(dir);

	const result = strictGovernanceGraphQuery(dir, {
		scope,
		checkpoint,
		projectionVersion: 1,
		limit: 10,
		sort: "id",
		depth: 0,
	});

	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.checkpoint, checkpoint);
	assert.equal(result.projectionVersion, 1);
	assert.equal(result.nodes.length, 1);
	assert.equal(result.nodes[0].id, scope);
	assert.equal(result.degraded, false);
	assert.equal(result.gateSatisfiable, true);
});

test("checkpoint mismatch and scoped invalidation fail closed without rewriting history", () => {
	const dir = mkTarget("stale");
	admitIntent(dir, "intent/login");
	const scope = "intent/intent/login@1";
	const checkpoint = checkpointOf(dir);
	admitIntent(dir, "intent/other");
	const mismatch = strictGovernanceGraphQuery(dir, {
		scope,
		checkpoint,
		projectionVersion: 1,
		limit: 10,
		sort: "id",
		depth: 0,
	});
	assert.equal(mismatch.ok, false);
	assert.equal(mismatch.code, "AMBER_E_STRICT_QUERY_CHECKPOINT_MISMATCH");

	const freshCheckpoint = checkpointOf(dir);
	const recorded = recordInvalidation(dir, {
		subject: scope,
		dependency: { type: "evidence", identity: "evidence/run-1" },
		reason: "evidence hash changed",
	});
	assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));
	const receipts = listInvalidations(dir, { subject: scope });
	assert.equal(receipts.length, 1);
	const stale = strictGovernanceGraphQuery(dir, {
		scope,
		checkpoint: freshCheckpoint,
		projectionVersion: 1,
		limit: 10,
		sort: "id",
		depth: 0,
	});
	assert.equal(stale.ok, false);
	assert.equal(stale.code, "AMBER_E_STRICT_QUERY_STALE");
	assert.equal(stale.invalidations.length, 1);

	const unaffected = strictGovernanceGraphQuery(dir, {
		scope: "intent/intent/other@1",
		checkpoint: freshCheckpoint,
		projectionVersion: 1,
		limit: 10,
		sort: "id",
		depth: 0,
	});
	assert.equal(unaffected.ok, true, (unaffected.errors || []).join("; "));
});

test("strict query cursor is bound to request shape and expires", () => {
	const dir = mkTarget("cursor");
	admitIntent(dir, "intent/a");
	const accepted = admitArtifact(dir, {
		type: "intent",
		identity: "intent/a",
		body: "# Intent A accepted",
		expectedHead: 1,
		transition: "accept",
	});
	assert.equal(accepted.ok, true, (accepted.errors || []).join("; "));
	const spec = admitArtifact(dir, {
		type: "spec",
		identity: "spec/a",
		body: "# Spec A",
		traces: [{ type: "refines", to: { identity: "intent/a", revision: 2 } }],
	});
	assert.equal(spec.ok, true, (spec.errors || []).join("; "));
	const checkpoint = checkpointOf(dir);
	const scope = "intent/intent/a@2";
	const page = strictGovernanceGraphQuery(
		dir,
		{ scope, checkpoint, projectionVersion: 1, limit: 1, sort: "id", depth: 1 },
		{ now: new Date("2026-08-27T00:00:00.000Z") },
	);
	assert.equal(page.ok, true, (page.errors || []).join("; "));
	assert.equal(page.truncated, true);
	assert.equal(page.degraded, true);
	assert.equal(page.gateSatisfiable, false);
	assert.ok(page.cursor);

	const mismatch = strictGovernanceGraphQuery(dir, {
		scope,
		checkpoint,
		projectionVersion: 1,
		limit: 2,
		sort: "id",
		depth: 1,
		cursor: page.cursor,
	});
	assert.equal(mismatch.ok, false);
	assert.equal(mismatch.code, "AMBER_E_STRICT_QUERY_CURSOR_INVALID");

	const expired = strictGovernanceGraphQuery(
		dir,
		{
			scope,
			checkpoint,
			projectionVersion: 1,
			limit: 1,
			sort: "id",
			depth: 1,
			cursor: page.cursor,
		},
		{ now: new Date("2026-08-27T00:10:01.000Z") },
	);
	assert.equal(expired.ok, false);
	assert.equal(expired.code, "AMBER_E_STRICT_QUERY_CURSOR_EXPIRED");
});

test("tampered staleness ledger fails every read closed", () => {
	const dir = mkTarget("tamper");
	const receipt = recordInvalidation(dir, {
		subject: "intent/intent/login@1",
		dependency: {
			type: "policy",
			identity: "policy/org",
			revision: 1,
			contentHash: "sha256:" + "a".repeat(64),
		},
		reason: "policy changed",
	});
	assert.equal(receipt.ok, true, (receipt.errors || []).join("; "));
	const events = fs
		.readFileSync(ledgerPath(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	events[0].reason = "edited";
	writeJSONL(ledgerPath(dir), events);
	assert.throws(
		() => listInvalidations(dir),
		(err) => err.amberCode === "AMBER_E_STALENESS_REGISTRY_CORRUPT",
	);
});
