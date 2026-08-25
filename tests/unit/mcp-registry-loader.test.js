"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadActionTypes, loadFunctions } = require("../../scripts/lib/mcp-registry-loader");

const ROOT = path.resolve(__dirname, "../..");

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-mcp-registry-"));
}

test("Action registry loading fails closed when any manifest is invalid", () => {
	const dir = tempDir();
	fs.copyFileSync(
		path.join(ROOT, "action-types", "session-status.json"),
		path.join(dir, "valid.json"),
	);
	fs.writeFileSync(path.join(dir, "broken.json"), "{ not valid json ");

	assert.throws(
		() => loadActionTypes({ directory: dir, schemaName: "action.type" }),
		/action registry is invalid.*broken\.json.*invalid JSON/s,
	);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("session.start capability declares every durable write surface", () => {
	const { COMMAND_CAPABILITIES } = require("../../scripts/lib/mcp-action-contracts");
	assert.deepEqual(
		new Set(COMMAND_CAPABILITIES["session/start"].edits),
		new Set([
			".amber/sessions/<id>/manifest.json",
			".amber/sessions/<id>/timeline.jsonl",
			".amber/sessions/<id>/gates/<gate>.gate.json",
			"MEMORY.md",
			"notes.md",
			"tasks/README.md",
		]),
	);
});

test("Function registry loading fails closed when any module is invalid", () => {
	const dir = tempDir();
	fs.writeFileSync(
		path.join(dir, "broken.json"),
		JSON.stringify({ name: "amber.fn.broken", inputSchema: { type: "object" } }),
	);

	assert.throws(
		() => loadFunctions({ directory: dir }),
		/function registry is invalid.*broken\.json.*missing description/s,
	);
	fs.rmSync(dir, { recursive: true, force: true });
});
