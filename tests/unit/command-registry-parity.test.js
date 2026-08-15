"use strict";

// Command registration is one interface: callers should not have to reconcile
// separate command, help, policy, and handler maps.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { COMMANDS, DEFAULT_COMMANDS, run } = require("../../scripts/amber.js");
const {
	COMMAND_REGISTRY,
	DEPRECATED_COMMANDS,
	dispatch,
} = require("../../scripts/lib/command-dispatcher.js");
const {
	COMMAND_DEFINITIONS,
	COMMAND_TIERS,
	bindCommandHandlers,
	validateCommandRegistry,
} = require("../../scripts/lib/command-registry.js");

const PUBLIC_COMMAND_ORDER = [
	"init",
	"audit",
	"wiki",
	"doctor",
	"handoff",
	"plan",
	"gate",
	"review",
	"accept",
	"learnings",
	"pack",
	"profile",
	"task",
	"result",
	"agent",
	"team",
	"maintenance",
	"adoption",
	"loop",
	"ledger",
	"route",
	"session",
	"status",
	"drift",
	"sync",
	"migrate",
	"governance",
	"execution",
	"security",
	"feature",
	"clean",
	"next",
	"explain",
	"hooks",
	"workflow",
	"context",
];

test("one Command registry drives help, policy, dispatch, and the public command list", () => {
	assert.ok(COMMAND_DEFINITIONS, "Command definitions must be exported from one module");
	assert.ok(COMMAND_REGISTRY, "Command handlers must bind to the definitions at startup");
	assert.deepEqual(COMMANDS, PUBLIC_COMMAND_ORDER);
	assert.deepEqual(Object.keys(COMMAND_DEFINITIONS), COMMANDS);
	assert.deepEqual(Object.keys(COMMAND_REGISTRY), COMMANDS);

	for (const name of COMMANDS) {
		const definition = COMMAND_DEFINITIONS[name];
		const registration = COMMAND_REGISTRY[name];
		assert.equal(definition.name, name);
		assert.ok(["core", "journey", "deprecated", "expert"].includes(definition.tier));
		assert.ok(definition.help, `${name} must own its help knowledge`);
		assert.ok(definition.output, `${name} must own its output policy`);
		assert.equal(typeof definition.typed, "boolean");
		assert.equal(registration.definition, definition);
		assert.equal(typeof registration.handler, "function");
	}
});

test("Command tiers are the single visibility source", () => {
	assert.deepEqual(Object.keys(COMMAND_TIERS), COMMANDS);
	assert.deepEqual(
		DEFAULT_COMMANDS,
		COMMANDS.filter((name) => ["journey", "core"].includes(COMMAND_TIERS[name])),
	);
	assert.deepEqual(
		new Set(COMMANDS.filter((name) => COMMAND_TIERS[name] === "deprecated")),
		DEPRECATED_COMMANDS,
	);
});

test("Command handler binding fails fast on missing or orphaned handlers", () => {
	assert.throws(() => bindCommandHandlers({}), /missing handlers/i);
	const handlers = Object.fromEntries(
		Object.keys(COMMAND_DEFINITIONS).map((name) => [name, () => ({ result: {} })]),
	);
	handlers.orphaned = () => ({ result: {} });
	assert.throws(() => bindCommandHandlers(handlers), /orphaned handlers/i);
});

test("Command registry rejects capabilities without a Command Definition", () => {
	assert.throws(
		() =>
			validateCommandRegistry({
				definitions: { session: { name: "session" } },
				capabilities: {
					"session/status": {},
					"unknown/read": {},
				},
			}),
		/undefined commands \[unknown\]/i,
	);
	assert.equal(validateCommandRegistry(), true);
});

test("Command Definitions own typed coverage and must stay capability-parity aligned", () => {
	const definitions = {
		session: { name: "session", typed: true },
		context: { name: "context", typed: false },
	};
	assert.throws(
		() =>
			validateCommandRegistry({
				definitions,
				capabilities: { "session/status": {}, "context/preview": {} },
			}),
		/typed parity mismatch.*untyped capabilities \[context\]/i,
	);
	assert.throws(
		() =>
			validateCommandRegistry({
				definitions: { session: { name: "session", typed: true } },
				capabilities: {},
			}),
		/typed parity mismatch.*missing capabilities \[session\]/i,
	);
});

test("deprecated warnings are added after asynchronous handlers resolve", async () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-async-deprecated-"));
	DEPRECATED_COMMANDS.add("session");
	try {
		const response = await dispatch("session", { _: ["status"], target });
		assert.match(response.result.warnings.join("\n"), /deprecated/i);
	} finally {
		DEPRECATED_COMMANDS.delete("session");
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("bypass responses with errors produce a non-zero CLI exit", async () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-bypass-error-"));
	const originalLog = console.log;
	console.log = () => {};
	try {
		assert.equal(
			await run(["ledger", "export", "--home", "all", "--format", "json", "--target", target]),
			1,
		);
	} finally {
		console.log = originalLog;
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// F022: the hooks Command Definition must keep documenting the breadcrumb
// surface (subcommands, opt-in boundary, bypass env) — the workflow-state
// contract doc names this test as its registry-drift anchor.
test("hooks help and usage document the breadcrumb subcommand surface", () => {
	const definition = COMMAND_DEFINITIONS.hooks;
	const help = definition.help.join("\n");
	assert.match(help, /breadcrumb/);
	for (const sub of ["print", "install", "uninstall", "status"]) {
		assert.match(
			help,
			new RegExp(`breadcrumb.*${sub}|${sub}.*breadcrumb`),
			`help must mention breadcrumb ${sub}`,
		);
	}
	assert.match(help, /opt-in/i);
	assert.match(help, /AMBER_SKIP_HOOKS/);
	assert.match(definition.output.usage, /breadcrumb <print\|install\|uninstall\|status>/);
	assert.match(definition.output.usage, /--format/);
});
