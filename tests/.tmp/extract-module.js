"use strict";
// One-off refactor tool: extract functions/constants from harness-core.js
// into scripts/lib/core/<module>.js as a TRUE MOVE (cut, not copy).
//
// Usage:
//   node tests/.tmp/extract-module.js <module-name> --fns a,b,c [--consts X,Y] [--dry]
//
// Behavior:
// - Cuts the named top-level function/const blocks byte-for-byte out of
//   harness-core.js and writes them to scripts/lib/core/<module>.js.
// - Scans moved bodies for identifiers: references to symbols already moved
//   to other core modules become require() lines; references to symbols
//   still living in harness-core.js ABORT the run (topological-order guard).
// - Inserts `const { ... } = require("./core/<module>")` into harness-core.js
//   at the __CORE_REQUIRES__ anchor so internal callers keep working.
// - module.exports list in harness-core.js is left untouched.
const fs = require("node:fs");
const path = require("node:path");

const LIB = path.join(__dirname, "..", "..", "scripts", "lib");
const CORE = path.join(LIB, "core");
const TARGET = path.join(LIB, "harness-core.js");
const MANIFEST = path.join(__dirname, "extract-manifest.json");
const ANCHOR = "// __CORE_REQUIRES__";

// ---------- parsing ----------

function parseBlocks(source) {
	// Returns top-level blocks: { kind: fn|const, name, start, end } (line idx, inclusive)
	const lines = source.split("\n");
	const blocks = [];
	let depth = 0;
	let current = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (depth === 0 && !current) {
			const fnMatch = line.match(/^(?:async )?function ([A-Za-z0-9_]+)\s*\(/);
			const constMatch = line.match(/^const ([A-Za-z0-9_]+) =/);
			if (fnMatch) current = { kind: "fn", name: fnMatch[1], start: i };
			else if (constMatch) current = { kind: "const", name: constMatch[1], start: i };
		}
		if (current) {
			for (const ch of line) {
				if (ch === "{" || ch === "[" || ch === "(") depth += 1;
				else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
			}
			if (depth === 0 && (current.kind === "fn" ? line.includes("}") : line.trimEnd().endsWith(";"))) {
				current.end = i;
				blocks.push(current);
				current = null;
			}
		}
	}
	return { lines, blocks };
}

function stripStringsAndComments(code) {
	// Crude but effective: blank out string/comment contents so identifier
	// scanning does not see words inside messages. Keeps template ${...} parts.
	return code
		.replace(/\/\/[^\n]*/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
		.replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
		.replace(/`(?:[^`\\$]|\\.|\$(?!\{))*(?:\$\{[^}]*\}(?:[^`\\$]|\\.|\$(?!\{))*)*`/g, (m) => {
			const inner = [...m.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(" ; ");
			return "` " + inner + " `";
		});
}

function identifiers(code) {
	const ids = new Set();
	for (const m of stripStringsAndComments(code).matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
		ids.add(m[0]);
	}
	return ids;
}

// ---------- manifest of already-extracted symbols ----------

function loadManifest() {
	if (fs.existsSync(MANIFEST)) return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
	return { modules: {} }; // moduleName -> [symbol, ...]
}

function saveManifest(m) {
	fs.writeFileSync(MANIFEST, JSON.stringify(m, null, "\t") + "\n");
}

// ---------- main ----------

function main() {
	const args = process.argv.slice(2);
	const moduleName = args[0];
	const dry = args.includes("--dry");
	const fnsArg = args.includes("--fns") ? args[args.indexOf("--fns") + 1] || "" : "";
	const constsArg = args.includes("--consts") ? args[args.indexOf("--consts") + 1] : "";
	if (!moduleName || (!fnsArg && !constsArg)) {
		console.error("usage: extract-module.js <name> --fns a,b,c [--consts X,Y] [--dry]");
		process.exit(2);
	}
	const wantFns = fnsArg.split(",").map((s) => s.trim()).filter(Boolean);
	const wantConsts = constsArg.split(",").map((s) => s.trim()).filter(Boolean);

	const source = fs.readFileSync(TARGET, "utf8");
	const { lines, blocks } = parseBlocks(source);
	const byName = new Map(blocks.map((b) => [b.name, b]));

	// Validate requested blocks exist
	const missing = [...wantFns, ...wantConsts].filter((n) => !byName.has(n));
	if (missing.length) {
		console.error("NOT FOUND in harness-core.js:", missing.join(", "));
		process.exit(1);
	}

	const manifest = loadManifest();
	const movedElsewhere = new Map(); // symbol -> module
	for (const [mod, syms] of Object.entries(manifest.modules)) {
		for (const s of syms) movedElsewhere.set(s, mod);
	}

	const moving = new Set([...wantFns, ...wantConsts]);
	const stayingFnsAndConsts = new Set(
		blocks.map((b) => b.name).filter((n) => !moving.has(n)),
	);

	// Collect moved code & scan dependencies
	const pieces = [];
	const deps = { node: new Set(), modules: new Map(), violations: new Set() };
	for (const name of [...wantConsts, ...wantFns]) {
		const b = byName.get(name);
		const code = lines.slice(b.start, b.end + 1).join("\n");
		pieces.push(code);
		for (const id of identifiers(code)) {
			if (id === name) continue;
			if (moving.has(id)) continue; // same new module
			if (id === "fs") deps.node.add('const fs = require("node:fs");');
			else if (id === "path") deps.node.add('const path = require("node:path");');
			else if (movedElsewhere.has(id)) {
				const mod = movedElsewhere.get(id);
				if (!deps.modules.has(mod)) deps.modules.set(mod, new Set());
				deps.modules.get(mod).add(id);
			} else if (stayingFnsAndConsts.has(id)) {
				deps.violations.add(`${name} -> ${id} (still in harness-core.js)`);
			}
		}
	}

	if (deps.violations.size) {
		console.error("TOPOLOGY VIOLATIONS (extract these first, or include them):");
		for (const v of deps.violations) console.error("  " + v);
		process.exit(1);
	}

	for (const code of pieces) {
		if (code.includes("__dirname")) {
			console.error(
				"WARNING: moved code uses __dirname — path depth changes in core/. Review and fix manually.",
			);
			break;
		}
	}

	// Build new module file
	const header = ['"use strict";', ""];
	for (const r of [...deps.node].sort()) header.push(r);
	if (deps.node.size) header.push("");
	for (const [mod, syms] of [...deps.modules.entries()].sort()) {
		header.push(`const {`);
		for (const s of [...syms].sort()) header.push(`\t${s},`);
		header.push(`} = require("./${mod}");`);
		header.push("");
	}
	const exportNames = [...wantConsts, ...wantFns];
	const moduleSource =
		header.join("\n") +
		"\n" +
		pieces.join("\n\n") +
		"\n\nmodule.exports = {\n" +
		exportNames.map((n) => `\t${n},`).join("\n") +
		"\n};\n";

	// Rewrite harness-core.js: remove moved blocks, add require at anchor
	const removeLines = new Set();
	for (const name of moving) {
		const b = byName.get(name);
		for (let i = b.start; i <= b.end; i++) removeLines.add(i);
	}
	let newLines = lines.filter((_, i) => !removeLines.has(i));
	// collapse runs of 3+ blank lines left by removal
	const collapsed = [];
	let blanks = 0;
	for (const l of newLines) {
		if (l.trim() === "") {
			blanks += 1;
			if (blanks > 2) continue;
		} else blanks = 0;
		collapsed.push(l);
	}
	newLines = collapsed;

	const requireLine = `const {\n${exportNames.map((n) => `\t${n},`).join("\n")}\n} = require("./core/${moduleName}");`;
	let anchorIdx = newLines.findIndex((l) => l.trim() === ANCHOR);
	if (anchorIdx === -1) {
		const pathReq = newLines.findIndex((l) => l.includes('require("node:path")'));
		newLines.splice(pathReq + 1, 0, "", ANCHOR);
		anchorIdx = pathReq + 2;
	}
	newLines.splice(anchorIdx + 1, 0, requireLine);

	if (dry) {
		console.log("--- would write", path.join(CORE, moduleName + ".js"), `(${moduleSource.split("\n").length} lines)`);
		console.log("--- harness-core.js:", lines.length, "->", newLines.length, "lines");
		console.log("--- requires:", [...deps.modules.keys()].join(", ") || "(none beyond node)");
		return;
	}

	fs.mkdirSync(CORE, { recursive: true });
	fs.writeFileSync(path.join(CORE, moduleName + ".js"), moduleSource);
	fs.writeFileSync(TARGET, newLines.join("\n"));
	manifest.modules[moduleName] = exportNames;
	saveManifest(manifest);
	console.log(`extracted ${exportNames.length} symbols -> core/${moduleName}.js`);
	console.log(`harness-core.js: ${lines.length} -> ${newLines.length} lines`);
}

main();
