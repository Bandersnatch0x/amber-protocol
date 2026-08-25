"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
	defineCommand,
	createSubcommandDispatcher,
} = require("../../scripts/lib/subcommand-dispatcher");

function makeCommand(overrides = {}) {
	return defineCommand({
		command: "demo",
		actions: ["read", "write"],
		handlers: {
			read: () => ({ text: "read ok" }),
			write: (args) => ({ text: `wrote ${args.id || "none"}` }),
			...(overrides.handlers || {}),
		},
		...overrides,
	});
}

test("routes a known action and shapes the full envelope", () => {
	const dispatch = makeCommand();
	const envelope = dispatch("read", { target: "some-repo" });
	assert.deepEqual(envelope, {
		result: { target: "some-repo", text: "read ok", errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: true,
	});
});

test("resolves aliases to canonical handlers", () => {
	const dispatch = makeCommand({ aliases: { ls: "read" } });
	const envelope = dispatch("ls", { target: "t" });
	assert.equal(envelope.result.text, "read ok");
});

test("unknown action returns the unknownAction envelope with exit code 1", () => {
	const dispatch = makeCommand();
	const envelope = dispatch("nope", { target: "t" });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, undefined);
	assert.deepEqual(envelope.result.errors, ["demo requires read, or write."]);
	assert.deepEqual(envelope.result.warnings, []);
});

test("custom unknown handler shapes through the same unknown path", () => {
	const dispatch = makeCommand({ unknown: () => ({ errors: ["custom"], warnings: [] }) });
	const envelope = dispatch("nope", { target: "t" });
	assert.equal(envelope.exitCode, 1);
	assert.deepEqual(envelope.result.errors, ["custom"]);
});

test("exit code derivation: explicit body.exitCode wins over every rule", () => {
	const dispatch = makeCommand({ handlers: { read: () => ({ text: "x", exitCode: 2 }) } });
	assert.equal(dispatch("read", {}).exitCode, 2);
});

test("exit code derivation: body.ok === false yields 1 even without errors", () => {
	const dispatch = makeCommand({ handlers: { read: () => ({ text: "x", ok: false }) } });
	assert.equal(dispatch("read", {}).exitCode, 1);
});

test("exit code derivation: errors present yields 1", () => {
	const dispatch = makeCommand({ handlers: { read: () => ({ errors: ["bad"] }) } });
	assert.equal(dispatch("read", {}).exitCode, 1);
});

test("exit code derivation: clean body yields 0", () => {
	const dispatch = makeCommand({ handlers: { read: () => ({ text: "x" }) } });
	assert.equal(dispatch("read", {}).exitCode, 0);
});

test("control fields never leak into result", () => {
	const dispatch = makeCommand({
		handlers: {
			read: () => ({
				text: "x",
				ok: false,
				exitCode: 1,
				bypassPrint: false,
				onBypass: () => {},
			}),
		},
	});
	const envelope = dispatch("read", { target: "t", json: true });
	assert.deepEqual(envelope.result, { target: "t", text: "x", errors: [], warnings: [] });
	assert.equal(envelope.exitCode, 1);
	assert.equal(envelope.bypassPrint, false);
	assert.equal(typeof envelope.onBypass, "function");
});

test("bypassPrint defaults to !args.json and body can override", () => {
	const dispatch = makeCommand({ handlers: { read: () => ({ text: "x" }) } });
	assert.equal(dispatch("read", {}).bypassPrint, true);
	assert.equal(dispatch("read", { json: true }).bypassPrint, false);
	const override = makeCommand({ handlers: { read: () => ({ text: "x", bypassPrint: true }) } });
	assert.equal(override("read", { json: true }).bypassPrint, true);
});

test("body code and extra fields pass through into result", () => {
	const dispatch = makeCommand({
		handlers: { read: () => ({ text: "x", code: "AMBER_E_DEMO", extra: 1 }) },
	});
	const envelope = dispatch("read", { target: "t" });
	assert.equal(envelope.result.code, "AMBER_E_DEMO");
	assert.equal(envelope.result.extra, 1);
});

test("handler receives args untouched", () => {
	const dispatch = makeCommand();
	assert.equal(dispatch("write", { target: "t", id: "abc" }).result.text, "wrote abc");
});

test("createSubcommandDispatcher still dispatches (regression)", () => {
	const dispatch = createSubcommandDispatcher({
		actions: ["a"],
		handlers: { a: () => ({ ok: true }) },
		unknownHandler: () => ({ errors: ["nope"] }),
		envelope: (result) => ({ result, exitCode: result.errors ? 1 : 0 }),
	});
	assert.deepEqual(dispatch("a"), { result: { ok: true }, exitCode: 0 });
	assert.deepEqual(dispatch("zzz"), { result: { errors: ["nope"] }, exitCode: 1 });
});
