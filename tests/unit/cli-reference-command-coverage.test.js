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

// issues/0150 (adjudicated under issues/0141): the reference stayed hand-written,
// so the registry's own option contract is the mechanical check. Every invocation
// the reference shows must use only options that the registry declares for that
// command (or its subcommands), which is what the generated skill/MCP surfaces
// are built from. Descriptions and examples are deliberately out of scope.
const GLOBAL_OPTIONS = new Set([
	"--target",
	"--json",
	"--help",
	"--all",
	"--verbose",
	"--quiet",
	"--force",
	"--yes",
	"--confirm",
]);

function registry() {
	return require(REGISTRY);
}

function allowedOptionsByCommand() {
	const reg = registry();
	const allowed = new Map();
	for (const command of reg.COMMANDS) {
		const options = new Set([
			...(reg.commandInvocationContract(command)?.allowedOptions || []),
			...GLOBAL_OPTIONS,
		]);
		for (const subcommand of reg.knownSubcommands(command) || []) {
			for (const option of reg.commandInvocationContract(command, subcommand)?.allowedOptions ||
				[]) {
				options.add(option);
			}
		}
		allowed.set(command, options);
	}
	return allowed;
}

function invocationSpans(doc) {
	return [...doc.matchAll(/`([^`\n]*amber [^`\n]*)`/g)].map((match) => match[1]);
}

function normalizeInvocation(span) {
	return span.replace(/^\s*(\$\s*)?(node\s+scripts\/amber\.js|amber)\s+/, "").trim();
}

function optionViolations(doc) {
	const reg = registry();
	const allowed = allowedOptionsByCommand();
	const violations = [];
	for (const span of invocationSpans(doc)) {
		const invocation = normalizeInvocation(span);
		// Top-level flags (`amber --help`) and placeholder forms (`amber <command>`)
		// are not command invocations.
		if (!invocation || invocation.startsWith("--") || invocation.startsWith("<")) continue;
		const command = invocation.split(/\s+/)[0];
		if (!reg.COMMANDS.includes(command)) {
			violations.push(`${invocation} — \`${command}\` is not a registry command`);
			continue;
		}
		const options = new Set(allowed.get(command));
		const unknown = [...new Set([...invocation.matchAll(/--[a-z0-9-]+/g)].map((m) => m[0]))].filter(
			(option) => !options.has(option),
		);
		if (unknown.length > 0) {
			violations.push(`${invocation} — undeclared option(s): ${unknown.join(", ")}`);
		}
	}
	return violations;
}

test("documented invocations use only registry-declared options", () => {
	const doc = fs.readFileSync(CLI_REFERENCE, "utf8");
	const violations = optionViolations(doc);
	assert.deepEqual(
		violations,
		[],
		`documented invocations disagree with the registry:\n${violations.join("\n")}`,
	);
});

test("the option gate discriminates: an invented option is reported", () => {
	const doc = fs.readFileSync(CLI_REFERENCE, "utf8");
	const probe = "amber session lease --session <id> --owner-id";
	assert.ok(doc.includes(probe), "the discrimination fixture must name a real documented span");
	const tampered = doc.replace(
		probe,
		"amber session lease --session <id> --not-a-real-option --owner-id",
	);
	const violations = optionViolations(tampered);
	assert.ok(
		violations.some((entry) => entry.includes("--not-a-real-option")),
		"an undeclared option must be reported",
	);
});
