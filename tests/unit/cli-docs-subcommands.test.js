"use strict";

// The generated CLI reference listed every subcommand and described none of
// them: 235 rows across 36 pages read "Subcommand action for <command>". The
// prose was never missing — `documentedSubcommands()` had already parsed the
// "Subcommands:" help block for names and discarded everything after them.
//
// This guard covers the generated site. The hand-written docs/CLI_REFERENCE.md
// keeps its own F011 coverage check, which is a different contract.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { documentedSubcommandDetails } = require("../../scripts/lib/command-registry");

const CLI_DOCS = path.join(__dirname, "..", "..", "apps", "docs", "docs", "reference", "cli");

test("no generated CLI page carries a placeholder subcommand description", () => {
	const offenders = [];
	for (const file of fs.readdirSync(CLI_DOCS).filter((name) => name.endsWith(".md"))) {
		const page = fs.readFileSync(path.join(CLI_DOCS, file), "utf8");
		if (page.includes("Subcommand action for")) offenders.push(file);
	}
	assert.deepEqual(
		offenders,
		[],
		`placeholders survived in: ${offenders.join(", ")} — run: node scripts/gen-docs-cli.js`,
	);
});

test("a subcommand description carries no unescaped MDX tag", () => {
	// These pages are .md compiled as MDX. A help-block summary such as
	// "Required: --file <contract.json>" reaches the table verbatim, and MDX
	// reads <contract.json> as an unclosed JSX tag — the docs build dies on a
	// page no unit test was looking at. Signatures are already safe in backticks.
	const pages = fs.readdirSync(CLI_DOCS).filter((name) => name.endsWith(".md"));
	for (const file of pages) {
		const page = fs.readFileSync(path.join(CLI_DOCS, file), "utf8");
		for (const line of page.split("\n")) {
			if (!line.startsWith("| <code>")) continue;
			const outsideCode = line.replace(/`[^`]*`/g, "").replace(/<\/?code>/g, "");
			// Only `<tag` and `</tag` start JSX. A bare `>` (as in "recurrence >= 2")
			// is inert inside a table cell, so it must not trip this guard.
			assert.ok(
				!/<[A-Za-z/]/.test(outsideCode),
				`${file} has an unescaped MDX tag opener: ${line.slice(0, 120)}`,
			);
		}
	}
});

test("the help block yields prose from all three documented layouts", () => {
	const route = documentedSubcommandDetails("route");
	// Signature and prose on the same row, split by the alignment gutter.
	assert.match(route.list?.summary || "", /List all routes/i);
	assert.match(route.inspect?.summary || "", /stage tree/i);
	assert.equal(route.inspect?.signature, "<id>");
	// Prose only on the following indented lines.
	const session = documentedSubcommandDetails("session");
	assert.match(session.start?.summary || "", /Create a new session/i);
	// A signature stays a signature — never mistaken for prose.
	assert.equal(session.abort?.signature, "<id>");
	// A verb documented only in the usage line has no help-block entry at all;
	// the generator renders "—" instead of inventing prose for it.
	assert.equal(session["verify-ledger"], undefined);
});
