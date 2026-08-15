"use strict";

// Break-loop prevention anchor (#118 → #122): calendar days in bookkeeping
// must come from the shared localIsoDate helper. This suite pins the helper's
// semantics and refuses the raw UTC-slice idiom anywhere under scripts/.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { localIsoDate } = require("../../scripts/lib/core/text-utils");

const SCRIPTS_ROOT = path.join(__dirname, "..", "..", "scripts");
const RAW_UTC_SLICE = "toISOString().slice(0, 10)";

function walkJsFiles(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort()) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "compat") continue;
			walkJsFiles(full, out);
		} else if (entry.name.endsWith(".js")) {
			out.push(full);
		}
	}
	return out;
}

test("localIsoDate returns the local calendar day for divergence-prone instants", () => {
	for (const d of [new Date(2026, 7, 15, 0, 30), new Date(2026, 7, 15, 23, 0)]) {
		assert.equal(localIsoDate(d), d.toLocaleDateString("en-CA"));
		assert.equal(localIsoDate(d), "2026-08-15");
	}
});

test("scripts/ contain no raw UTC calendar-day slice (break-loop #118/#122)", () => {
	const offenders = [];
	for (const file of walkJsFiles(SCRIPTS_ROOT)) {
		if (fs.readFileSync(file, "utf8").includes(RAW_UTC_SLICE)) {
			offenders.push(path.relative(SCRIPTS_ROOT, file).split(path.sep).join("/"));
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`raw UTC calendar-day slice found — import localIsoDate from lib/core/text-utils instead: ${offenders.join(", ")}`,
	);
});
