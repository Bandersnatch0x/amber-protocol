"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadActionTypes, loadFunctions } = require("../../scripts/lib/mcp-registry-loader");

const ROOT = path.resolve(__dirname, "../..");
const SCHEMA_PATH = path.join(ROOT, "schemas", "action.type.schema.json");

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
		() => loadActionTypes({ directory: dir, schemaPath: SCHEMA_PATH }),
		/action registry is invalid.*broken\.json.*invalid JSON/s,
	);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("Function registry loading fails closed when any module is invalid", () => {
	const dir = tempDir();
	fs.writeFileSync(
		path.join(dir, "broken.js"),
		'module.exports = { name: "amber.fn.broken", inputSchema: { type: "object" } };\n',
	);

	assert.throws(
		() => loadFunctions({ directory: dir }),
		/function registry is invalid.*broken\.js.*missing handler/s,
	);
	fs.rmSync(dir, { recursive: true, force: true });
});
