"use strict";

// F042 guard (seam-adoption ritual): no module outside the schema-contract seam
// may instantiate Ajv or require("ajv"). The PENDING list names the survey
// Finding 3 adapters still awaiting migration; it must shrink to empty and the
// guard then fails on ANY new construction site.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const SCRIPTS = path.join(REPO, "scripts");
const SEAM = ["lib", "core", "schema-contract.js"].join("/");

// The migration is complete: every adapter compiles through the seam, and the
// guard now fails on ANY new Ajv construction site outside it.
const PENDING = new Set([]);

function scanAjvSites(dir) {
	const sites = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			sites.push(...scanAjvSites(full));
			continue;
		}
		if (!entry.name.endsWith(".js")) continue;
		const rel = path.relative(SCRIPTS, full).split(path.sep).join("/");
		const text = fs.readFileSync(full, "utf8");
		if (/new\s+Ajv\s*\(/.test(text) || /require\(["']ajv["']\)/.test(text)) {
			sites.push(rel);
		}
	}
	return sites;
}

test("no Ajv construction outside the schema-contract seam (beyond the shrinking pending list)", () => {
	const sites = scanAjvSites(SCRIPTS).filter((rel) => rel !== SEAM);
	const outside = sites.filter((rel) => !PENDING.has(rel));
	assert.deepEqual(
		outside,
		[],
		`new Ajv / require("ajv") sites outside the seam and the pending list: ${outside.join(", ")}`,
	);
});

test("every pending-list entry still exists and still holds an Ajv site (the list tracks reality)", () => {
	const sites = new Set(scanAjvSites(SCRIPTS));
	for (const rel of PENDING) {
		assert.ok(
			sites.has(rel),
			`${rel} is pending migration but no longer has an Ajv site — remove it from the list`,
		);
	}
});
