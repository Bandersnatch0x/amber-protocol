#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LIB_DIR = path.join(ROOT, "scripts", "lib");
const ENTRY_DIRS = ["scripts", "scripts/compat", "scripts/demo", "dsh", "src"];
const WEB_SERVER_DIR = path.join(ROOT, "apps", "web", "server");
const SKIPPED_DIRS = new Set(["node_modules", "fixtures"]);

const STRING_REQUIRE = /require(?:\.resolve)?\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const DIRNAME_REQUIRE =
	/require(?:\.resolve)?\(\s*path\.(?:join|resolve)\(\s*__dirname\s*,([^)]*)\)\s*\)/g;
const WEB_REQUIRE_CLI = /requireCli\(\s*["']([^"']+)["']\s*\)/g;

function listFiles(dir, suffixes, recursive) {
	if (!fs.existsSync(dir)) return [];
	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (recursive && !SKIPPED_DIRS.has(entry.name)) {
				files.push(...listFiles(full, suffixes, recursive));
			}
		} else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
			files.push(full);
		}
	}
	return files;
}

function resolveModule(fromDir, specifier) {
	if (!specifier.startsWith(".") && !path.isAbsolute(specifier)) return null;
	const base = path.resolve(fromDir, specifier);
	const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")];
	return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) || null;
}

function dirnameSegments(argList) {
	const segments = [];
	for (const raw of argList.split(",")) {
		const match = raw.trim().match(/^["'`]([^"'`]+)["'`]$/);
		if (!match) return null;
		segments.push(match[1]);
	}
	return segments;
}

function requiredFiles(file) {
	if (!file.endsWith(".js")) return [];
	const source = fs.readFileSync(file, "utf8");
	const dir = path.dirname(file);
	const found = [];
	for (const match of source.matchAll(STRING_REQUIRE)) {
		found.push(resolveModule(dir, match[1]));
	}
	for (const match of source.matchAll(DIRNAME_REQUIRE)) {
		const segments = dirnameSegments(match[1]);
		if (segments) found.push(resolveModule(dir, `./${path.join(...segments)}`));
	}
	return found.filter(Boolean);
}

function entryFiles() {
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	const entries = Object.values(pkg.bin || {}).map((bin) => path.join(ROOT, bin));
	for (const dir of ENTRY_DIRS) {
		entries.push(...listFiles(path.join(ROOT, dir), [".js"], dir === "src"));
	}
	for (const file of listFiles(WEB_SERVER_DIR, [".ts"], true)) {
		const source = fs.readFileSync(file, "utf8");
		for (const match of source.matchAll(WEB_REQUIRE_CLI)) {
			const resolved = resolveModule(path.dirname(file), match[1]);
			if (resolved) entries.push(resolved);
		}
	}
	return entries;
}

function findUnreachable() {
	const seen = new Set();
	const queue = entryFiles();
	while (queue.length > 0) {
		const file = queue.pop();
		if (seen.has(file)) continue;
		seen.add(file);
		queue.push(...requiredFiles(file));
	}
	return listFiles(LIB_DIR, [".js"], true)
		.filter((file) => !seen.has(file))
		.map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
		.sort();
}

if (require.main === module) {
	const unreachable = findUnreachable();
	for (const file of unreachable) console.log(file);
	console.log(`${unreachable.length} unreachable files`);
	process.exitCode = unreachable.length === 0 ? 0 : 1;
}

module.exports = { findUnreachable };
