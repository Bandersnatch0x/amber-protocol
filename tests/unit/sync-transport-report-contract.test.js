"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	validateSyncTransportReport,
} = require("../../scripts/lib/core/sync-transport-report-contract");
const { pushEnvelopes } = require("../../scripts/lib/core/sync-session");
const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
const { mkTarget } = require("../helpers/harness");

const SCHEMA_PATH = path.join(
	__dirname,
	"..",
	"..",
	"schemas",
	"sync-transport-report.schema.json",
);

function validReport() {
	return {
		schemaVersion: "1.0.0",
		mode: "prepare",
		envelopeCount: 1,
		envelopeIds: ["0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"],
		envelopePaths: [".amber/sync/envelopes/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.json"],
		affectedPaths: [".amber/sync/envelopes/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.json"],
		proposedOps: [
			{ verb: "add", paths: [".amber/sync"] },
			{ verb: "commit", message: "amber sync: 1 envelope(s)" },
		],
		remoteConfigured: false,
		conflictCount: 0,
		refusedCount: 0,
		note: "Prepared 1 envelope(s) for transport.",
		errors: [],
	};
}

function packOne(dir) {
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.mkdirSync(path.join(dir, ".amber/context/pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber/context/pages/page.json"), "# Page\n");
	const { envelope, errors } = packEnvelope(dir, "context-page", ".amber/context/pages/page.json");
	assert.deepEqual(errors, []);
	return envelope;
}

// ── published schema shape ────────────────────────────────────

test("the transport-report schema is draft-07, version-closed, and additionalProperties:false", () => {
	const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
	assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
	assert.equal(schema.$id, "amber/sync-transport-report.schema.json");
	assert.deepEqual(schema.properties.schemaVersion.enum, ["1.0.0"]);
	assert.equal(schema.additionalProperties, false);
	assert.ok(schema.required.includes("schemaVersion"), "schemaVersion is required (ADR-0012)");
	const ops = schema.properties.proposedOps.items;
	assert.ok(ops.oneOf, "proposedOps items are a oneOf of structured operations");
	const verbs = ops.oneOf.map((branch) => branch.properties.verb.enum[0]).sort();
	assert.deepEqual(verbs, ["add", "commit", "push"], "closed verb set");
});

// ── contract validation ───────────────────────────────────────

test("a full valid report passes", () => {
	const v = validateSyncTransportReport(validReport());
	assert.equal(v.valid, true);
	assert.deepEqual(v.errors, []);
});

test("an empty report with no proposed ops passes", () => {
	const report = validReport();
	report.envelopeCount = 0;
	report.envelopeIds = [];
	report.envelopePaths = [];
	report.affectedPaths = [];
	report.proposedOps = [];
	report.note = "No envelopes to prepare; no git operations proposed.";
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, true);
});

test("a wrong schemaVersion is rejected", () => {
	const report = validReport();
	report.schemaVersion = "0.9.0";
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false);
	assert.ok(v.errors.some((e) => e.includes("schemaVersion")));
});

test("a mode other than prepare is rejected", () => {
	const report = validReport();
	report.mode = "execute";
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false);
	assert.ok(v.errors.some((e) => e.includes("mode")));
});

test("an op without a verb is rejected", () => {
	const report = validReport();
	report.proposedOps = [{ paths: [".amber/sync"] }];
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false);
});

test("an add op without paths is rejected", () => {
	const report = validReport();
	report.proposedOps = [{ verb: "add" }, { verb: "commit", message: "m" }];
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false);
});

test("a commit op without a message is rejected", () => {
	const report = validReport();
	report.proposedOps = [{ verb: "add", paths: [".amber/sync"] }, { verb: "commit" }];
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false);
});

test("an unknown verb is rejected", () => {
	const report = validReport();
	report.proposedOps = [{ verb: "rebase", onto: "main" }];
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false);
});

test("a shell-string op is rejected (injection hazard, ADR-0020 Option 3)", () => {
	const report = validReport();
	report.proposedOps = ["git add .amber/sync; rm -rf /"];
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false, "shell strings must not validate as operations");
});

test("an additional property on the report is rejected", () => {
	const report = validReport();
	report.escapeHatch = "--execute";
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false);
	assert.ok(v.errors.some((e) => e.includes("escapeHatch")));
});

test("an additional property on an op is rejected", () => {
	const report = validReport();
	report.proposedOps = [{ verb: "add", paths: [".amber/sync"], force: true }];
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, false);
});

test("a push op carries no extra fields and validates only alone-shaped", () => {
	const report = validReport();
	report.remoteConfigured = true;
	report.proposedOps = [
		{ verb: "add", paths: [".amber/sync"] },
		{ verb: "commit", message: "amber sync: 1 envelope(s)" },
		{ verb: "push" },
	];
	assert.equal(validateSyncTransportReport(report).valid, true);
	report.proposedOps[2] = { verb: "push", force: true };
	assert.equal(validateSyncTransportReport(report).valid, false);
});

// ── producer invariant: every emitted report validates ────────

test("pushEnvelopes emits a schema-valid report with structured ops (no remote)", () => {
	const dir = mkTarget("contract-no-remote", { git: true });
	packOne(dir);
	const report = pushEnvelopes(dir);
	assert.equal(report.schemaVersion, "1.0.0");
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, true, `produced report must validate: ${JSON.stringify(v.errors)}`);
	assert.ok(
		report.proposedOps.some((op) => op.verb === "add" && op.paths.includes(".amber/sync")),
		"the add op carries its confined paths",
	);
	assert.ok(
		report.proposedOps.some((op) => op.verb === "commit" && op.message.startsWith("amber sync:")),
		"the commit op carries its derived message",
	);
	assert.equal(
		report.proposedOps.some((op) => op.verb === "push"),
		false,
		"no push op without a remote",
	);
	assert.ok(
		report.proposedOps.every((op) => typeof op === "object" && typeof op.verb === "string"),
	);
});

test("pushEnvelopes emits a schema-valid report with a push op when a remote exists", () => {
	const { spawnSync } = require("node:child_process");
	const dir = mkTarget("contract-remote", { git: true });
	packOne(dir);
	const remote = spawnSync("git", ["remote", "add", "origin", "https://example.com/hub.git"], {
		cwd: dir,
		encoding: "utf8",
	});
	assert.equal(remote.status, 0, (remote.stderr || "").toString());
	const report = pushEnvelopes(dir);
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, true, `produced report must validate: ${JSON.stringify(v.errors)}`);
	assert.ok(report.proposedOps.some((op) => op.verb === "push"));
});

test("pushEnvelopes with no envelopes emits a schema-valid empty report", () => {
	const dir = mkTarget("contract-empty", { git: true });
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	const report = pushEnvelopes(dir);
	assert.deepEqual(report.proposedOps, []);
	const v = validateSyncTransportReport(report);
	assert.equal(v.valid, true, `produced report must validate: ${JSON.stringify(v.errors)}`);
});
