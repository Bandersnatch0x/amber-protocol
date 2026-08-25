"use strict";

// F039 slice 4: pin contextDispatch envelopes so the defineCommand migration
// stays byte-compatible with the hand-rolled envelopes it replaced. The
// verify branch keeps its legacy envelope (payload `ok` is inexpressible as a
// defineCommand body field); everything else routes through the dispatcher.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { contextDispatch, ACTIONS } = require("../../scripts/lib/context/adapters/command");

function tmpRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ctx-dispatch-"));
	fs.mkdirSync(path.join(root, "docs", "wiki", "agent"), { recursive: true });
	fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
	fs.mkdirSync(path.join(root, "routes"), { recursive: true });
	fs.mkdirSync(path.join(root, "scripts", "lib", "core"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "docs", "wiki", "agent", "amber.md"),
		"# Amber Operating Manual\n",
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "docs", "wiki", "agent", "context-loadout.md"),
		"# Context Loadout Definition\n",
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "routes", "feature-standard.route.json"),
		JSON.stringify({ routeId: "feature-standard", schemaVersion: "1.0.0", stages: [] }),
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "scripts", "lib", "core", "governed-runner.js"),
		"const gates = 5;\n",
		"utf8",
	);
	return root;
}

test("known action envelope: target, text, defaulted errors/warnings, exit 0, bypassPrint", () => {
	const root = tmpRoot();
	const envelope = contextDispatch("request", {
		target: root,
		_: ["context", "request"],
		page: "governed-execution",
		title: "Governed execution",
		source: "scripts/lib/core/governed-runner.js",
	});
	assert.deepEqual(envelope, {
		result: { target: root, text: envelope.result.text, errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: true,
	});
	assert.match(envelope.result.text, /^Request kd-/);
	fs.rmSync(root, { recursive: true, force: true });
});

test("known action honors --json: bypassPrint false", () => {
	const root = tmpRoot();
	const envelope = contextDispatch("request", {
		target: root,
		_: ["context", "request"],
		page: "governed-execution",
		title: "Governed execution",
		source: "scripts/lib/core/governed-runner.js",
		json: true,
	});
	assert.equal(envelope.bypassPrint, false);
	assert.equal(envelope.exitCode, 0);
	fs.rmSync(root, { recursive: true, force: true });
});

test("error envelope keeps the legacy errResult shape: target undefined, exit 1, bypassPrint false", () => {
	const root = tmpRoot();
	const envelope = contextDispatch("request", { target: root, _: ["context", "request"] });
	assert.deepEqual(envelope, {
		result: {
			target: undefined,
			errors: ["context request requires --page <id> (kebab-case)."],
			warnings: [],
		},
		exitCode: 1,
		bypassPrint: false,
	});
	fs.rmSync(root, { recursive: true, force: true });
});

test("unknown action: exit 1, guidance on the printResult path, no target on the wire", () => {
	const envelope = contextDispatch("bogus", { target: "t", _: ["context", "bogus"] });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, undefined);
	assert.deepEqual(envelope.result.errors, [
		`unknown context action: bogus. Expected one of: ${ACTIONS.join(", ")}`,
	]);
	assert.equal(JSON.stringify(envelope.result).includes('"target"'), false);
});

test("projection routing: aliases pin the variant, the bare action reads it off _", () => {
	const root = tmpRoot();
	const viaAlias = contextDispatch("projection-status", {
		target: root,
		_: ["context", "projection-status"],
	});
	assert.equal(viaAlias.exitCode, 1);
	assert.equal(viaAlias.bypassPrint, false);
	assert.equal(viaAlias.result.code, "AMBER_E_CONTEXT_PROJECTION_MISSING");

	const viaSubaction = contextDispatch("projection", {
		target: root,
		_: ["context", "projection", "status"],
	});
	assert.equal(viaSubaction.result.code, "AMBER_E_CONTEXT_PROJECTION_MISSING");

	const noVariant = contextDispatch("projection", { target: root, _: ["context", "projection"] });
	assert.deepEqual(noVariant.result.errors, ["context projection requires status or rebuild"]);
	assert.equal(noVariant.result.target, undefined);

	const rebuilt = contextDispatch("projection-rebuild", {
		target: root,
		_: ["context", "projection-rebuild"],
	});
	assert.equal(rebuilt.exitCode, 0);
	const status = contextDispatch("projection", {
		target: root,
		_: ["context", "projection", "status"],
	});
	assert.equal(status.exitCode, 0);
	assert.equal(status.bypassPrint, true);
	assert.match(status.result.text, /^context-index: /);
	fs.rmSync(root, { recursive: true, force: true });
});
