"use strict";

// F060 phase 1 (#262; ADR-0025): synthetic-corpus tests for the deterministic
// code extractor. The corpus here owns its own census — every fixture file is
// written by the test, so membership, symbol tables, and import resolution
// are asserted against known ground truth, never against the live tree
// (which tests/unit/knowledge-graph.test.js covers through invariants).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	CODE_EXTENSIONS,
	extractCodeCorpus,
	typescriptVersion,
} = require("../../scripts/lib/core/code-graph");
const { mkTarget } = require("../helpers/harness");

function write(root, rel, content) {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content);
}

test("typescript version is reported for provenance", () => {
	assert.match(typescriptVersion(), /^\d+\.\d+\.\d+/);
});

test("census: scope admits product code and excludes tests, declarations, hidden, generated, and top-level docs", () => {
	const dir = mkTarget("cg-census");
	write(dir, "lib/a.js", "module.exports = {};\n");
	write(dir, "lib/b.ts", "export const b = 1;\n");
	write(dir, "lib/view.tsx", "export const View = () => null;\n");
	write(dir, "lib/c.mjs", "export const c = 1;\n");
	write(dir, "lib/d.cjs", "module.exports = {};\n");
	// excluded: tests directories and test/spec files
	write(dir, "tests/unit/x.test.js", "module.exports = {};\n");
	write(dir, "lib/e2e/flow.js", "module.exports = {};\n");
	write(dir, "lib/a.test.js", "module.exports = {};\n");
	write(dir, "lib/a.spec.ts", "export {};\n");
	write(dir, "lib/__tests__/y.js", "module.exports = {};\n");
	// excluded: declarations, hidden dirs, dependency/build output
	write(dir, "lib/types.d.ts", "export type T = 1;\n");
	write(dir, ".hidden/z.js", "module.exports = {};\n");
	write(dir, "node_modules/pkg/index.js", "module.exports = {};\n");
	write(dir, "web/dist/bundle.js", "module.exports = {};\n");
	write(dir, "web/build/x.js", "module.exports = {};\n");
	write(dir, "web/coverage/x.js", "module.exports = {};\n");
	write(dir, "web/output/x.js", "module.exports = {};\n");
	write(dir, "web/tmp/x.js", "module.exports = {};\n");
	// excluded: top-level docs payload; included: nested docs directory
	write(dir, "docs/reference/example.ts", "export const nope = 1;\n");
	write(dir, "lib/docs/inner.js", "module.exports = {};\n");
	// excluded: non-code files
	write(dir, "lib/readme.md", "# not code\n");
	write(dir, "lib/data.json", "{}\n");

	const corpus = extractCodeCorpus(dir);
	assert.deepEqual(
		corpus.files.map((f) => f.sourcePath),
		["lib/a.js", "lib/b.ts", "lib/c.mjs", "lib/d.cjs", "lib/docs/inner.js", "lib/view.tsx"],
	);
});

test("symbol tables: ESM declarations, named/aliased/type exports, default, and namespace re-export", () => {
	const dir = mkTarget("cg-esm");
	write(
		dir,
		"src/mod.ts",
		[
			"export function alpha() {}",
			"export const beta = 1, gamma = 2;",
			"export const { delta, epsilon } = { delta: 1, epsilon: 2 };",
			"export class Zeta {}",
			"export interface Eta { x: number }",
			"export type Theta = string;",
			"export enum Iota { A }",
			"const kappa = 1;",
			"export { kappa as lambda };",
			"export default function mu() {}",
			"",
		].join("\n"),
	);
	write(dir, "src/other.ts", "export const nu = 1;\nexport * as everything from './mod';\n");

	const corpus = extractCodeCorpus(dir);
	const mod = corpus.files.find((f) => f.sourcePath === "src/mod.ts");
	assert.deepEqual(
		mod.symbols.map((s) => s.name),
		[
			"alpha",
			"beta",
			"gamma",
			"delta",
			"epsilon",
			"Zeta",
			"Eta",
			"Theta",
			"Iota",
			"lambda",
			"default",
		],
	);
	// positions are 1-based and ordered (startLine, startCol, name)
	for (const symbol of mod.symbols) {
		assert.ok(symbol.startLine >= 1 && symbol.startCol >= 1);
	}
	const sorted = [...mod.symbols].sort((a, b) => {
		if (a.startLine !== b.startLine) return a.startLine - b.startLine;
		if (a.startCol !== b.startCol) return a.startCol - b.startCol;
		return a.name < b.name ? -1 : 1;
	});
	assert.deepEqual(mod.symbols, sorted);
	const other = corpus.files.find((f) => f.sourcePath === "src/other.ts");
	assert.deepEqual(
		other.symbols.map((s) => s.name),
		["nu", "everything"],
	);
});

test("symbol tables: CommonJS module.exports object, Object.freeze unwrap, and exports.name assignments", () => {
	const dir = mkTarget("cg-cjs");
	write(
		dir,
		"lib/plain.js",
		[
			"function one() {}",
			"const two = 2;",
			"module.exports = { one, two, three: 3, 'four': 4 };",
			"",
		].join("\n"),
	);
	write(dir, "lib/frozen.js", "module.exports = Object.freeze({ frozenOne: 1, frozenTwo: 2 });\n");
	write(
		dir,
		"lib/assigned.js",
		["exports.first = 1;", "module.exports.second = 2;", ""].join("\n"),
	);

	const corpus = extractCodeCorpus(dir);
	const names = (rel) => corpus.files.find((f) => f.sourcePath === rel).symbols.map((s) => s.name);
	assert.deepEqual(names("lib/plain.js"), ["one", "two", "three", "four"]);
	assert.deepEqual(names("lib/frozen.js"), ["frozenOne", "frozenTwo"]);
	assert.deepEqual(names("lib/assigned.js"), ["first", "second"]);
});

test("re-exports: export * closure resolves through chains and never pulls default", () => {
	const dir = mkTarget("cg-star");
	write(dir, "src/base.ts", "export const fromBase = 1;\nexport default 2;\n");
	write(dir, "src/middle.ts", "export * from './base';\nexport const fromMiddle = 1;\n");
	write(
		dir,
		"src/top.ts",
		"export * from './middle';\nexport { fromBase as renamed } from './base';\n",
	);

	const corpus = extractCodeCorpus(dir);
	const top = corpus.files.find((f) => f.sourcePath === "src/top.ts");
	assert.deepEqual(top.symbols.map((s) => s.name).sort(), ["fromBase", "fromMiddle", "renamed"]);
	// star-pulled names carry the export-star statement position
	const pulled = top.symbols.find((s) => s.name === "fromMiddle");
	assert.equal(pulled.startLine, 1);
	// the re-export chain is also an import edge chain
	const edges = corpus.imports.map((e) => `${e.src} -> ${e.dst}`);
	assert.ok(edges.includes("src/middle.ts -> src/base.ts"));
	assert.ok(edges.includes("src/top.ts -> src/middle.ts"));
	assert.ok(edges.includes("src/top.ts -> src/base.ts"));
});

test("import resolution: relative, index, extension probes, JS->TS remap, require(), and dynamic import()", () => {
	const dir = mkTarget("cg-resolve");
	write(dir, "src/dir/index.ts", "export const idx = 1;\n");
	write(dir, "src/impl.ts", "export const impl = 1;\n");
	write(
		dir,
		"src/user.ts",
		[
			"import { idx } from './dir';",
			"import { impl } from './impl.js';",
			"export const user = idx + impl;",
			"",
		].join("\n"),
	);
	write(
		dir,
		"lib/loader.js",
		[
			"const helper = require('./helper');",
			"async function load() { return import('./lazy.js'); }",
			"module.exports = { load };",
			"",
		].join("\n"),
	);
	write(dir, "lib/helper.js", "module.exports = { help: 1 };\n");
	write(dir, "lib/lazy.js", "module.exports = { lazy: 1 };\n");

	const corpus = extractCodeCorpus(dir);
	const edges = corpus.imports.map((e) => `${e.src} -> ${e.dst}`);
	assert.ok(edges.includes("src/user.ts -> src/dir/index.ts"), "index probe");
	assert.ok(edges.includes("src/user.ts -> src/impl.ts"), "JS specifier resolves to TS source");
	assert.ok(edges.includes("lib/loader.js -> lib/helper.js"), "require()");
	assert.ok(edges.includes("lib/loader.js -> lib/lazy.js"), "dynamic import()");
	// bare and node: specifiers never resolve into the corpus
	assert.ok(edges.every((e) => !e.includes("undefined")));
});

test("import resolution: tsconfig paths aliases resolve; external and unresolved specifiers drop", () => {
	const dir = mkTarget("cg-alias");
	write(
		dir,
		"web/tsconfig.app.json",
		JSON.stringify({
			compilerOptions: { paths: { "@/*": ["./src/*"] } },
		}),
	);
	write(dir, "web/src/lib/dto.ts", "export type DTO = { x: number };\n");
	write(
		dir,
		"web/src/page.tsx",
		[
			"import type { DTO } from '@/lib/dto';",
			"import missing from './does-not-exist';",
			"import react from 'react';",
			"import fs from 'node:fs';",
			"export const page: DTO = { x: 1 };",
			"",
		].join("\n"),
	);

	const corpus = extractCodeCorpus(dir);
	assert.deepEqual(
		corpus.imports.map((e) => `${e.src} -> ${e.dst}`),
		["web/src/page.tsx -> web/src/lib/dto.ts"],
	);
});

test("imports aggregate per file pair with per-statement evidence in line order", () => {
	const dir = mkTarget("cg-aggregate");
	write(dir, "lib/dep.js", "module.exports = { a: 1, b: 2 };\n");
	write(
		dir,
		"lib/use.js",
		[
			"const { a } = require('./dep');",
			"const again = require('./dep');",
			"module.exports = { a, again };",
			"",
		].join("\n"),
	);

	const corpus = extractCodeCorpus(dir);
	assert.equal(corpus.imports.length, 1);
	const edge = corpus.imports[0];
	assert.equal(edge.src, "lib/use.js");
	assert.equal(edge.dst, "lib/dep.js");
	assert.deepEqual(edge.evidence, [
		{ path: "lib/use.js", line: 1 },
		{ path: "lib/use.js", line: 2 },
	]);
});

test("determinism: POSIX paths, byte-identical recompute, and creation-order independence", () => {
	const build = (label, order) => {
		const dir = mkTarget(label);
		for (const name of order) {
			write(
				dir,
				`lib/${name}.js`,
				`const dep = require('./zz-dep');\nmodule.exports = { ${name}: dep };\n`,
			);
		}
		write(dir, "lib/zz-dep.js", "module.exports = { dep: 1 };\n");
		return extractCodeCorpus(dir);
	};
	const forward = build("cg-order-a", ["alpha", "beta", "gamma"]);
	const shuffled = build("cg-order-b", ["gamma", "alpha", "beta"]);
	const strip = (corpus) => JSON.stringify(corpus);
	assert.equal(strip(forward), strip(shuffled), "discovery order must not leak into output");
	for (const file of forward.files) {
		assert.ok(!file.sourcePath.includes("\\"), "sourcePath must be POSIX");
	}
	assert.deepEqual(
		forward.files.map((f) => f.sourcePath),
		[...forward.files.map((f) => f.sourcePath)].sort(),
	);
});

test("CRLF checkouts and LF checkouts extract identical tables and positions", () => {
	const lf = mkTarget("cg-lf");
	const crlf = mkTarget("cg-crlf");
	const body = "const x = 1;\nexport function crossPlatform() {}\nexport const tail = x;\n";
	write(lf, "src/mod.ts", body);
	write(crlf, "src/mod.ts", body.replace(/\n/g, "\r\n"));

	const a = extractCodeCorpus(lf);
	const b = extractCodeCorpus(crlf);
	assert.deepEqual(a, b);
	const symbols = a.files[0].symbols;
	assert.deepEqual(
		symbols.map((s) => `${s.name}@${s.startLine}`),
		["crossPlatform@2", "tail@3"],
	);
});

test("self-imports and cycles neither loop nor self-edge", () => {
	const dir = mkTarget("cg-cycle");
	write(
		dir,
		"lib/a.js",
		"const b = require('./b');\nconst self = require('./a');\nmodule.exports = { a: 1 };\n",
	);
	write(dir, "lib/b.js", "const a = require('./a');\nmodule.exports = { b: 1 };\n");
	// star-re-export cycle
	write(dir, "src/x.ts", "export * from './y';\nexport const xOwn = 1;\n");
	write(dir, "src/y.ts", "export * from './x';\nexport const yOwn = 1;\n");

	const corpus = extractCodeCorpus(dir);
	for (const edge of corpus.imports) assert.notEqual(edge.src, edge.dst);
	const x = corpus.files.find((f) => f.sourcePath === "src/x.ts");
	const y = corpus.files.find((f) => f.sourcePath === "src/y.ts");
	assert.deepEqual(x.symbols.map((s) => s.name).sort(), ["xOwn", "yOwn"]);
	assert.deepEqual(y.symbols.map((s) => s.name).sort(), ["xOwn", "yOwn"]);
});

test("an empty target yields an empty corpus; extension contract is frozen", () => {
	const dir = mkTarget("cg-empty");
	const corpus = extractCodeCorpus(dir);
	assert.deepEqual(corpus, { files: [], imports: [] });
	assert.deepEqual([...CODE_EXTENSIONS], [".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
});
