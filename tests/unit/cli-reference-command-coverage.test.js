"use strict";

// F011 set the rule that docs/CLI_REFERENCE.md documents every command the CLI
// schedules, and closed with the then-current 33 commands covered. Nothing made
// the next omission visible, so the surface grew to 56 commands and `phase`
// (a real expert-tier command with six subverbs) silently had no section at all
// — the same rot the harness section suffered, caught only by a manual audit.
//
// This guard covers the top level: every command in COMMANDS must be documented
// by one of the three shapes the reference actually uses. It does not police
// subverbs per section (the harness section has its own finer guard), and it
// does not attempt to generate the file — F011 rejected that as YAGNI.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(ROOT, "scripts", "lib", "command-registry.js");
const CLI_REFERENCE = path.join(ROOT, "docs", "CLI_REFERENCE.md");

function declaredCommands() {
	const source = fs.readFileSync(REGISTRY, "utf8");
	const match = /const COMMANDS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(source);
	assert.ok(match, "command-registry.js must declare the COMMANDS list");
	return [...match[1].matchAll(/"([a-z0-9-]+)"/g)].map((entry) => entry[1]);
}

function escapeForRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The reference documents a command in one of three ways, and both are real
// documentation of it:
//   1. a heading naming the command (`### explain`, `## Phase Commands`);
//   2. a full invocation token (`amber contracts validate …`);
//   3. a code span that STARTS with the command (`phase validate --phase …`
//      in a shared-prefix list).
// Anything weaker (the bare word appearing in prose) does not count — that is
// how `phase` looked documented while having no section.
function documentedIn(doc, command) {
	const escaped = escapeForRegExp(command);
	return [
		new RegExp("^#{2,4}\\s+.*\\b" + escaped + "\\b", "m"),
		new RegExp("`amber " + escaped + "\\b"),
		new RegExp("`" + escaped + "(?=[\\s`<|]|--)[^`]*`"),
	].some((rule) => rule.test(doc));
}

test("every command in COMMANDS is documented in docs/CLI_REFERENCE.md", () => {
	const commands = declaredCommands();
	assert.ok(commands.length > 40, `expected the full command surface, got ${commands.length}`);
	const doc = fs.readFileSync(CLI_REFERENCE, "utf8");
	const missing = commands.filter((command) => !documentedIn(doc, command));
	assert.deepEqual(
		missing,
		[],
		`commands missing from docs/CLI_REFERENCE.md: ${missing.join(", ")}`,
	);
});

test("the coverage rule discriminates: a command with every mention removed is reported", () => {
	const doc = fs.readFileSync(CLI_REFERENCE, "utf8");
	// A guard that cannot fail is worse than none: strip every occurrence of one
	// command and require the rule to report it (prose mentions included, so this
	// holds regardless of which documentation shape the command used).
	const stripped = doc.replace(/contracts/g, "redacted");
	assert.ok(
		!documentedIn(stripped, "contracts"),
		"removing every mention must make the command undocumented",
	);
	assert.ok(
		documentedIn(stripped, "phase"),
		"unrelated commands must stay documented when one command is stripped",
	);
});

test("the dependency note for phase records that it has no promotion shortcut", () => {
	const doc = fs.readFileSync(CLI_REFERENCE, "utf8");
	const start = doc.indexOf("## Phase Commands");
	assert.ok(start >= 0, "CLI_REFERENCE must document the phase surface");
	const end = doc.indexOf("\n## ", start);
	const section = doc.slice(start, end > start ? end : start + 3000);
	// The boundary is the point of the section: evidence before promotion,
	// authorization for promotion, checkpoint for rollback, never destructive.
	assert.match(section, /complete deterministic evidence/);
	assert.match(section, /explicit authorization/);
	assert.match(section, /never destructive/);
});
