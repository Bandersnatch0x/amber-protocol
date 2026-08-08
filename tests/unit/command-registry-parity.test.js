"use strict";

// Command registration is one interface: callers should not have to reconcile
// separate command, help, policy, and handler maps.

const test = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS } = require("../../scripts/amber.js");
const { COMMAND_REGISTRY } = require("../../scripts/lib/command-dispatcher.js");
const { COMMAND_DEFINITIONS, bindCommandHandlers } = require("../../scripts/lib/command-help.js");

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
		assert.ok(definition.help, `${name} must own its help knowledge`);
		assert.ok(definition.output, `${name} must own its output policy`);
		assert.equal(registration.definition, definition);
		assert.equal(typeof registration.handler, "function");
	}
});

test("Command handler binding fails fast on missing or orphaned handlers", () => {
	assert.throws(() => bindCommandHandlers({}), /missing handlers/i);
	const handlers = Object.fromEntries(
		Object.keys(COMMAND_DEFINITIONS).map((name) => [name, () => ({ result: {} })]),
	);
	handlers.orphaned = () => ({ result: {} });
	assert.throws(() => bindCommandHandlers(handlers), /orphaned handlers/i);
});
