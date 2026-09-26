"use strict";

// F011 set the rule that docs/CLI_REFERENCE.md documents every command the CLI
// schedules. It was closed with the then-current surface covered, and then the
// harness surface grew from F072 to F081 without the reference following — the
// file kept claiming completeness while ten subverb families were missing. The
// finding surfaced during a merge review, not from a check, which is the failure
// mode this guard removes.
//
// Scope is deliberately ONE section. It does not police the whole reference
// (F011 rejected a whole-file generator as YAGNI); it makes the next forgotten
// harness verb a red test instead of a quiet rot.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const HARNESS_COMMANDS = path.join(ROOT, "scripts", "lib", "harness", "harness-commands.js");
const CLI_REFERENCE = path.join(ROOT, "docs", "CLI_REFERENCE.md");

function declaredHarnessActions() {
	const source = fs.readFileSync(HARNESS_COMMANDS, "utf8");
	const match = /actions:\s*\[([\s\S]*?)\],\s*handlers:/.exec(source);
	assert.ok(match, "harness-commands.js must declare its action list");
	return [...match[1].matchAll(/"([a-z0-9-]+)"/g)].map((entry) => entry[1]);
}

function harnessReferenceSection() {
	const doc = fs.readFileSync(CLI_REFERENCE, "utf8");
	const start = doc.indexOf("Harness Commands");
	assert.ok(start >= 0, "CLI_REFERENCE must keep a Harness Commands section");
	const end = doc.indexOf("\n## ", start);
	assert.ok(end > start, "the Harness Commands section must end at the next H2");
	return doc.slice(start, end);
}

function escapeForRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The rule is USAGE, not token presence. A bare `\bcontext\b` is already
// satisfied by unrelated inline code such as `context.granted`, and a naive
// slash-list rule is fooled by `context.granted`/`context.denied` slash
// separators. So the token must be followed by a real continuation: whitespace,
// a placeholder, a pipe, a flag, or the end of the code span — never a dot.
// A guard that cannot fail is worse than no guard.
function documentedIn(section, action) {
	const escaped = escapeForRegExp(action);
	const continuation = "(?=[\\s`<|]|--)";
	return [
		new RegExp("`harness " + escaped + "\\b" + continuation),
		new RegExp("/\\s*`" + escaped + "\\b" + continuation),
	].some((rule) => rule.test(section));
}

test("every declared harness action is documented in the CLI_REFERENCE Harness Commands section", () => {
	const actions = declaredHarnessActions();
	assert.ok(actions.length > 10, `expected the full harness surface, got ${actions.length}`);
	const section = harnessReferenceSection();
	const missing = actions.filter((action) => !documentedIn(section, action));
	assert.deepEqual(
		missing,
		[],
		`harness actions missing from docs/CLI_REFERENCE.md Harness Commands: ${missing.join(", ")}`,
	);
});

test("the usage rule discriminates: a removed subverb is reported, an unrelated token is not", () => {
	const section = harnessReferenceSection();
	const actions = declaredHarnessActions();
	// Removing a subverb's only usage makes it missing...
	const removedDiff = section.replace(/`harness diff\b/g, "`harness replaced");
	assert.deepEqual(
		actions.filter((action) => !documentedIn(removedDiff, action)),
		["diff"],
	);
	// ...while an unrelated inline token with the same word never satisfies it.
	const strippedContext = section.replace(/`harness context\b/g, "`harness replaced");
	const stillPresent = actions.filter((action) => !documentedIn(strippedContext, action));
	assert.ok(
		stillPresent.includes("context"),
		"`context.granted` must not stand in for the `context` subverb",
	);
});

test("the Harness Commands section stays free of the retired daemon surface", () => {
	const section = harnessReferenceSection();
	// The bounded maintenance runtime is `harness runtime daemon …`; the removed
	// top-level daemon command must never reappear here (the docs boundary guard
	// polices the whole file — this pins the harness text too).
	assert.doesNotMatch(section, /amber\.js daemon (start|status|stop)/);
});
