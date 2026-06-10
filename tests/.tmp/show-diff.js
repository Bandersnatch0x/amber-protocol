"use strict";
// Show actual diffs for flagged functions.
const fs = require("node:fs");
const path = require("node:path");

const LIB = path.join(__dirname, "..", "..", "scripts", "lib");
const CORE = path.join(LIB, "core");

function extractFunctions(source) {
	const lines = source.split("\n");
	const fns = new Map();
	let current = null;
	let depth = 0;
	for (const line of lines) {
		const m = line.match(/^(?:async )?function ([A-Za-z0-9_]+)\s*\(/);
		if (m && depth === 0) {
			current = { name: m[1], body: [] };
		}
		if (current) {
			current.body.push(line);
			for (const ch of line) {
				if (ch === "{") depth += 1;
				else if (ch === "}") depth -= 1;
			}
			if (depth === 0 && current.body.length > 0 && line.includes("}")) {
				fns.set(current.name, current.body.join("\n").trim());
				current = null;
			}
		}
	}
	return fns;
}

function lineDiff(a, b) {
	const al = a.split("\n");
	const bl = b.split("\n");
	const out = [];
	const max = Math.max(al.length, bl.length);
	for (let i = 0; i < max; i++) {
		if (al[i] !== bl[i]) {
			out.push(`  L${i + 1} local : ${al[i] === undefined ? "<absent>" : al[i]}`);
			out.push(`  L${i + 1} module: ${bl[i] === undefined ? "<absent>" : bl[i]}`);
			if (out.length > 40) {
				out.push("  ... (truncated)");
				break;
			}
		}
	}
	return out.join("\n");
}

const targets = process.argv.slice(2); // e.g. repoRelativePath:team.js
const localFns = extractFunctions(fs.readFileSync(path.join(LIB, "harness-core.js"), "utf8"));

for (const spec of targets) {
	const [name, moduleFile] = spec.split(":");
	const modSrc = fs.readFileSync(path.join(CORE, moduleFile), "utf8");
	const modFns = extractFunctions(modSrc);
	console.log(`\n===== ${name} (local vs ${moduleFile}) =====`);
	if (!localFns.has(name)) {
		console.log("local: MISSING");
		continue;
	}
	if (!modFns.has(name)) {
		console.log("module: MISSING");
		continue;
	}
	const d = lineDiff(localFns.get(name), modFns.get(name));
	console.log(d || "(identical)");
}
