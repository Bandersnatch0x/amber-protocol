"use strict";

// The CLI keys three separate maps by command name, in three files:
//   - COMMANDS       (scripts/amber.js)               presence + dispatch gate
//   - HANDLERS       (command-dispatcher.js)          name -> handler fn
//   - COMMAND_HELP   (command-help.js)                name -> `--help` text
// Nothing at runtime forces them to agree, so a command added to one and
// forgotten in another drifts silently: a command with no handler ("No handler
// registered"), an orphan handler unreachable from the CLI, or a command whose
// `--help` silently falls back to the generic default. This guard makes any such
// drift a red test instead. (It deliberately does NOT check the free-text
// subcommand lists inside handlers/help — guarding those would need the very
// command-descriptor registry this test lets us avoid building.)

const test = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS } = require("../../scripts/amber.js");
const { HANDLERS } = require("../../scripts/lib/command-dispatcher.js");
const { COMMAND_HELP } = require("../../scripts/lib/command-help.js");

const commands = new Set(COMMANDS);
const handlers = new Set(Object.keys(HANDLERS));
const help = new Set(Object.keys(COMMAND_HELP));

const missing = (from, into) => [...from].filter((c) => !into.has(c)).sort();

test("every registered command has a dispatch handler", () => {
	assert.deepEqual(missing(commands, handlers), []);
});

test("no orphan handler exists without a registered command", () => {
	assert.deepEqual(missing(handlers, commands), []);
});

test("every registered command has help text (no generic-default fallback)", () => {
	assert.deepEqual(missing(commands, help), []);
});

test("no orphan help entry exists without a registered command", () => {
	assert.deepEqual(missing(help, commands), []);
});
