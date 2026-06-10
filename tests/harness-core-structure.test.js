"use strict";
// Structural guard for the scripts/lib/core/ split:
// 1. every top-level function/const is defined in exactly ONE core module
//    (the first split attempt produced drifting duplicate copies — never again);
// 2. no core module requires the harness-core facade (circular require);
// 3. every core module stays under the repo's 800-line file ceiling.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CORE = path.join(__dirname, "..", "scripts", "lib", "core");

function topLevelDefinitions(source) {
	const names = [];
	let depth = 0;
	for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
		if (depth === 0) {
			const fn = line.match(/^(?:async )?function ([A-Za-z0-9_]+)\s*\(/);
			const cn = line.match(/^const ([A-Za-z0-9_]+) =/);
			if (fn) names.push(fn[1]);
			else if (cn && !/= require\(/.test(line)) names.push(cn[1]);
		}
		for (const ch of line) {
			if (ch === "{") depth += 1;
			else if (ch === "}") depth -= 1;
		}
	}
	return names;
}

const moduleFiles = fs.readdirSync(CORE).filter((f) => f.endsWith(".js"));

test("core modules define each symbol exactly once", () => {
	const seen = new Map();
	for (const file of moduleFiles) {
		const source = fs.readFileSync(path.join(CORE, file), "utf8");
		for (const name of topLevelDefinitions(source)) {
			assert.ok(
				!seen.has(name),
				`${name} defined in both ${seen.get(name)} and ${file}`,
			);
			seen.set(name, file);
		}
	}
	assert.ok(seen.size >= 170, `expected >=170 definitions, got ${seen.size}`);
});

test("core modules never require the harness-core facade", () => {
	for (const file of moduleFiles) {
		const source = fs.readFileSync(path.join(CORE, file), "utf8");
		assert.ok(
			!source.includes("harness-core"),
			`${file} must not require the facade (circular require)`,
		);
	}
});

test("core modules stay under the 800-line ceiling", () => {
	for (const file of moduleFiles) {
		const lineCount = fs
			.readFileSync(path.join(CORE, file), "utf8")
			.split("\n").length;
		assert.ok(lineCount <= 800, `${file} has ${lineCount} lines (max 800)`);
	}
});

test("harness-core facade contains no function definitions", () => {
	const facade = fs.readFileSync(
		path.join(CORE, "..", "harness-core.js"),
		"utf8",
	);
	assert.ok(
		!/^(?:async )?function /m.test(facade),
		"facade must stay a pure re-export file",
	);
});
