"use strict";
// One-off analysis: compare local function definitions in harness-core.js
// against same-named functions in core/*.js modules.
const fs = require("node:fs");
const path = require("node:path");

const LIB = path.join(__dirname, "..", "..", "scripts", "lib");
const CORE = path.join(LIB, "core");

function extractFunctions(source) {
	// Split source into top-level function blocks keyed by name.
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

const coreSource = fs.readFileSync(path.join(LIB, "harness-core.js"), "utf8");
const localFns = extractFunctions(coreSource);

const moduleFns = new Map(); // name -> { module, body }
for (const file of fs.readdirSync(CORE).filter((f) => f.endsWith(".js"))) {
	const src = fs.readFileSync(path.join(CORE, file), "utf8");
	for (const [name, body] of extractFunctions(src)) {
		if (!moduleFns.has(name)) moduleFns.set(name, []);
		moduleFns.get(name).push({ module: file, body });
	}
}

const identical = [];
const different = [];
const localOnly = [];
for (const [name, body] of localFns) {
	const copies = moduleFns.get(name);
	if (!copies) {
		localOnly.push(name);
		continue;
	}
	const allSame = copies.every((c) => c.body === body);
	const norm = (s) =>
		s
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l !== "")
			.join("\n");
	const allNormSame = copies.every((c) => norm(c.body) === norm(body));
	if (allSame) identical.push({ name, modules: copies.map((c) => c.module) });
	else if (allNormSame)
		identical.push({ name, modules: copies.map((c) => c.module), formatOnly: true });
	else
		different.push({
			name,
			modules: copies.map((c) => ({
				module: c.module,
				same: norm(c.body) === norm(body),
			})),
		});
}

// Duplicate copies across core modules (helper duplication)
const dupAcrossModules = [...moduleFns.entries()]
	.filter(([, copies]) => copies.length > 1)
	.map(([name, copies]) => ({ name, count: copies.length, modules: copies.map((c) => c.module) }));

console.log("== LOCAL ONLY (not yet extracted):", localOnly.length, "==");
console.log(localOnly.join(", "));
console.log("\n== IDENTICAL local vs module:", identical.length, "==");
console.log(identical.map((i) => i.name).join(", "));
console.log("\n== DIFFERENT local vs module:", different.length, "==");
for (const d of different) {
	console.log(`  ${d.name}: ${d.modules.map((m) => `${m.module}${m.same ? "(same)" : "(DIFF)"}`).join(", ")}`);
}
console.log("\n== DUPLICATED across core modules:", dupAcrossModules.length, "==");
for (const d of dupAcrossModules) {
	console.log(`  ${d.name} x${d.count}: ${d.modules.join(", ")}`);
}
