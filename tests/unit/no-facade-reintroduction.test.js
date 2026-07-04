"use strict";
// Permanent guard: the amber-core/harness-core facades were removed in 1.3.0
// (ADR-0005, #4 PR2). They must not return, and no active code may require them.
// scripts/compat/ is exempt — it deliberately forwards the legacy coding-harness
// bin name (rename-sunset is a separate concern).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..", "..");
const SCRIPTS_LIB = path.join(REPO, "scripts", "lib");
const SELF_REL = path.relative(REPO, __filename).split(path.sep).join("/");

const FACADE_FILES = [
	path.join(SCRIPTS_LIB, "amber-core.js"),
	path.join(SCRIPTS_LIB, "harness-core.js"),
];
// Matches any require(...) whose module path mentions a facade name.
const FACADE_REQUIRE = /require\([^)]*\b(amber-core|harness-core)\b/;

function* walkJs(dir, relBase) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (err) {
		if (err.code === "ENOENT") return;
		throw err;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		const rel = `${relBase}/${entry.name}`;
		if (entry.isDirectory()) {
			yield* walkJs(full, rel);
		} else if (entry.name.endsWith(".js")) {
			yield [rel, full];
		}
	}
}

test("the amber-core/harness-core facade files do not exist", () => {
	for (const file of FACADE_FILES) {
		assert.ok(
			!fs.existsSync(file),
			`${path.relative(REPO, file)} must not exist — facade removed in 1.3.0 (ADR-0005).`,
		);
	}
});

test("no active script or test requires the removed facade", () => {
	const offenders = [];
	const scanRoots = [
		[path.join(REPO, "scripts"), "scripts"],
		[path.join(REPO, "tests"), "tests"],
	];
	for (const [abs, relBase] of scanRoots) {
		for (const [rel, full] of walkJs(abs, relBase)) {
			if (rel === SELF_REL) continue; // this guard mentions the names by design
			if (rel.startsWith("scripts/compat/")) continue; // legacy bin forwarder
			const lines = fs.readFileSync(full, "utf8").split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (FACADE_REQUIRE.test(lines[i])) {
					offenders.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
				}
			}
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`active code requires the removed facade:\n${offenders.join("\n")}`,
	);
});
