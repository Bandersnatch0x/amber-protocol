"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { dispatch } = require("../scripts/lib/command-dispatcher");

const PACK = path.join(__dirname, "../workflow-packs/safe-amber-bootstrap.pack.json");

test("loop approve / verify-ledger route without throwing on bad input", async () => {
	const a = await dispatch("loop", {
		_: ["approve"],
		file: "nope.json",
		contract: "x",
		target: ".",
	});
	assert.ok(Array.isArray(a.result.errors), "approve returns an error envelope");
	const v = await dispatch("loop", { _: ["verify-ledger"], contract: "missing-xyz", target: "." });
	assert.ok(Array.isArray(v.result.errors), "verify-ledger returns an error envelope");
});

test("loop run without --execute still returns the dry-run path (regression)", async () => {
	const d = await dispatch("loop", {
		_: ["run"],
		file: PACK,
		contract: "daily-amber-triage",
		target: ".",
		dryRun: true,
	});
	assert.equal(d.result.mode, "dry-run");
	assert.equal(d.result.executesAnything, false);
});

test("unknown loop action lists the new approve + verify-ledger subcommands", async () => {
	const u = await dispatch("loop", { _: ["bogus"], target: "." });
	const msg = u.result.errors.join(" ");
	assert.ok(msg.includes("approve"), msg);
	assert.ok(msg.includes("verify-ledger"), msg);
});
