"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const IMPORT_RE = /require\(["']([^"']+)["']\)|from\s+["']([^"']+)["']/g;

function source(relativePath) {
	return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function productionFiles(relativeRoot) {
	const root = path.join(ROOT, relativeRoot);
	if (!fs.existsSync(root)) return [];
	const files = [];
	function walk(directory) {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(file);
			else if (/\.(?:js|ts|tsx)$/.test(entry.name)) files.push(file);
		}
	}
	walk(root);
	return files;
}

function relative(file) {
	return path.relative(ROOT, file).replace(/\\/g, "/");
}

function layerForResolvedPath(resolved) {
	const normalized = resolved.replace(/\\/g, "/").replace(/\.js$/, "");
	if (/\/scripts\/lib\/context\/adapters\/command$/.test(normalized)) return "adapter";
	if (/\/scripts\/lib\/context(?:\/index)?$/.test(normalized)) return "public";
	if (/\/scripts\/lib\/core\/context-[^/]+$/.test(normalized)) return "core";
	return null;
}

function contextImports(relativePath) {
	const file = path.join(ROOT, relativePath);
	const text = source(relativePath);
	const edges = [];
	for (const match of text.matchAll(IMPORT_RE)) {
		const specifier = match[1] || match[2];
		if (!specifier.startsWith(".")) continue;
		const targetLayer = layerForResolvedPath(path.resolve(path.dirname(file), specifier));
		if (targetLayer) edges.push({ specifier, targetLayer });
	}
	return edges;
}

function classifyEdge(importer, specifier) {
	const from = layerForResolvedPath(path.resolve(ROOT, importer));
	const target = layerForResolvedPath(path.resolve(ROOT, path.dirname(importer), specifier));
	return `${from || "external"}->${target || "other"}`;
}

describe("Context dependency direction", () => {
	it("routes the command dispatcher through the adapter and the adapter through one public Interface", () => {
		const dispatcher = source("scripts/lib/command-dispatcher.js");

		assert.match(dispatcher, /require\("\.\/context\/adapters\/command"\)/);
		assert.deepEqual(contextImports("scripts/lib/context/adapters/command.js"), [
			{ specifier: "../index", targetLayer: "public" },
		]);
	});

	it("rejects reverse imports across public, adapter, and core layers", () => {
		const violations = [];
		for (const file of productionFiles("scripts/lib/context")) {
			for (const edge of contextImports(relative(file))) {
				if (relative(file).includes("/adapters/")) {
					if (edge.targetLayer !== "public")
						violations.push(`${relative(file)} -> ${edge.targetLayer}`);
				} else if (edge.targetLayer === "adapter") {
					violations.push(`${relative(file)} -> ${edge.targetLayer}`);
				}
			}
		}
		for (const file of productionFiles("scripts/lib/core")) {
			for (const edge of contextImports(relative(file))) {
				if (edge.targetLayer === "public" || edge.targetLayer === "adapter") {
					violations.push(`${relative(file)} -> ${edge.targetLayer}`);
				}
			}
		}
		assert.deepEqual(violations, []);
	});

	it("prevents Web, transcript, and integration adapters from importing Context core directly", () => {
		const forbiddenRoots = ["apps/web/src", "server", "scripts/lib/integrations"];
		const violations = [];
		for (const root of forbiddenRoots) {
			for (const file of productionFiles(root)) {
				for (const dependency of contextImports(relative(file))) {
					if (dependency.targetLayer === "core") {
						violations.push(`${relative(file)} -> ${dependency.specifier}`);
					}
				}
			}
		}
		assert.deepEqual(violations, []);
	});

	it("detects representative forbidden edges instead of relying on production accidents", () => {
		assert.equal(
			classifyEdge("scripts/lib/context/index.js", "./adapters/command"),
			"public->adapter",
		);
		assert.equal(classifyEdge("scripts/lib/core/context-store.js", "../context"), "core->public");
		assert.equal(
			classifyEdge("scripts/lib/context/adapters/command.js", "../../core/context-store"),
			"adapter->core",
		);
		assert.equal(
			classifyEdge("apps/web/src/app.js", "../../../scripts/lib/core/context-store"),
			"external->core",
		);
		assert.equal(
			classifyEdge("scripts/lib/context/adapters/command.js", "../index"),
			"adapter->public",
		);
	});
});
