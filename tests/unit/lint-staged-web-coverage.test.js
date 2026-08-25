"use strict";

// F048 regression guard: the pre-commit hook must format every staged
// apps/web file the web format gate checks. The original bug was an
// extension-list glob (ts,tsx,css,html) that let .mjs/.mts/.js/.json
// staged files through untouched — prettier-drift then reached CI (F047).
// The fix is a catch-all web glob, so no extension can fall through;
// this test pins that invariant and the web-config flags.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const webPkg = JSON.parse(
	fs.readFileSync(path.join(repoRoot, "apps", "web", "package.json"), "utf8"),
);
const hookScript = fs.readFileSync(path.join(repoRoot, ".githooks", "pre-commit"), "utf8");

const WEB_GLOB = "apps/web/**";
const webTaskCommand = rootPkg["lint-staged"] && rootPkg["lint-staged"][WEB_GLOB];

test("lint-staged has a catch-all web task so no apps/web extension falls through", () => {
	assert.ok(webTaskCommand, `root package.json lint-staged must keep the "${WEB_GLOB}" entry`);
	// An extension list (e.g. apps/web/**/*.{ts,tsx}) re-opens the F047
	// coverage gap for any extension it omits — only the catch-all is safe.
	const globs = Object.keys(rootPkg["lint-staged"]);
	assert.ok(
		globs.every((g) => !g.startsWith("apps/web/") || g === WEB_GLOB),
		"the apps/web lint-staged glob must stay the catch-all, not an extension list",
	);
});

test("the web task runs prettier with the web config and ignore list", () => {
	assert.ok(
		webTaskCommand.includes("--config apps/web/.prettierrc.json"),
		"must pin the web config",
	);
	assert.ok(
		webTaskCommand.includes("--ignore-path apps/web/.prettierignore"),
		"must pin the web ignore list (keeps routeTree.gen.ts and dist/ untouched)",
	);
	assert.ok(webTaskCommand.includes("--write"), "must write fixes back for re-staging");
});

test("every path the web format gate checks is covered by the web task glob", () => {
	assert.equal(
		typeof webPkg.scripts["format:check"],
		"string",
		"apps/web needs a format:check script",
	);
	const gateArgs = webPkg.scripts["format:check"]
		.replace(/^prettier\s+--check\s+/, "")
		.split(/\s+/)
		.filter(Boolean);
	assert.ok(gateArgs.length > 0, "could not parse the format:check file list");
	for (const arg of gateArgs) {
		if (arg.includes("*")) {
			const dir = path.dirname(path.join(repoRoot, "apps", "web", arg));
			const pattern = path
				.basename(arg)
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, ".*");
			const re = new RegExp(`^${pattern}$`);
			const matches = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => re.test(n)) : [];
			assert.ok(
				matches.length > 0,
				`format:check glob matched no files: ${arg} (did the web scripts change?)`,
			);
			continue;
		}
		const resolved = path.resolve(repoRoot, "apps", "web", arg);
		assert.ok(
			fs.existsSync(resolved),
			`format:check references a missing path: apps/web/${arg} (did the web scripts change?)`,
		);
	}
});

test("the pre-commit hook still dispatches through lint-staged (no hook-script change needed)", () => {
	assert.match(hookScript, /lint-staged/, "hook must invoke lint-staged");
});
