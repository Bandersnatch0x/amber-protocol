"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-adapter-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function registerAdapterCli(dir, extra = []) {
	return runCli(
		[
			"adapter",
			"register",
			"--id",
			"adapter/legacy",
			"--adapter-owner",
			"legacy-team",
			"--record-type",
			"legacy-ticket",
			"--record-version",
			"v1",
			"--scope",
			"F051",
			"--identity-map",
			"path",
			"--freshness-ms",
			"86400000",
			"--allow-path",
			"legacy",
			...extra,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
}

test("adapter register/read/show/list/receipts lifecycle is read-only to artifacts", () => {
	const dir = mkTarget("lifecycle");
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	fs.writeFileSync(path.join(dir, "legacy", "item.json"), '{"id":"legacy-1"}\n');
	const registered = registerAdapterCli(dir);
	assert.equal(registered.status, 0, registered.stderr || registered.stdout);
	assert.equal(payload(registered).id, "adapter/legacy");

	const read = runCli(
		[
			"adapter",
			"read",
			"--id",
			"adapter/legacy",
			"--source",
			"legacy/item.json",
			"--record-id",
			"legacy-1",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(read.status, 0, read.stderr || read.stdout);
	const out = payload(read);
	assert.equal(out.receipt.adapterId, "adapter/legacy");
	assert.equal(out.receipt.recordId, "legacy-1");
	assert.match(out.receipt.sourceHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(out.source.bytes, '{"id":"legacy-1"}\n');
	assert.equal(fs.existsSync(path.join(dir, ".amber", "artifacts")), false);

	assert.equal(
		payload(runCli(["adapter", "show", "--id", "adapter/legacy", "--target", dir, "--json"], dir))
			.owner,
		"legacy-team",
	);
	assert.equal(payload(runCli(["adapter", "list", "--target", dir, "--json"], dir)).length, 1);
	assert.equal(
		payload(
			runCli(["adapter", "receipts", "--id", "adapter/legacy", "--target", dir, "--json"], dir),
		).length,
		1,
	);
});

test("adapter read refuses forbidden paths and missing adapters with stable codes", () => {
	const dir = mkTarget("errors");
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	fs.mkdirSync(path.join(dir, "other"), { recursive: true });
	fs.writeFileSync(path.join(dir, "other", "item.json"), "nope");
	assert.equal(registerAdapterCli(dir).status, 0);
	const forbidden = runCli(
		[
			"adapter",
			"read",
			"--id",
			"adapter/legacy",
			"--source",
			"other/item.json",
			"--record-id",
			"x",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(forbidden.status, 1);
	assert.equal(envelope(forbidden).code, "AMBER_E_ADAPTER_READ_FORBIDDEN");
	const missing = runCli(
		[
			"adapter",
			"read",
			"--id",
			"adapter/nope",
			"--source",
			"legacy/item.json",
			"--record-id",
			"x",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(missing.status, 1);
	assert.equal(envelope(missing).code, "AMBER_E_ADAPTER_NOT_FOUND");
});

test("adapter help is registered", () => {
	const r = runCli(["adapter", "--help"], ROOT);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(r.stdout.includes("adapter register"));
	assert.ok(r.stdout.includes("adapter read"));
});
