#!/usr/bin/env node
"use strict";

// issues/0347: the identity gate only protects a machine that actually runs it.
// `.githooks/pre-commit` holds that check, but it is live only when the repository
// sets core.hooksPath, and nothing kept it in place: the one known incident was a
// checkout with no user.email, committing 18 times as `coordinator@local` while the
// gate waited for PR time. This script is the self-wiring step (`npm install` runs it
// through `prepare`) and the drift report (`--check`).

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HOOKS_DIR = ".githooks";

function runGit(args, cwd) {
	return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

function effectiveHooksPath(repoRoot) {
	const result = runGit(["config", "--show-scope", "--get", "core.hooksPath"], repoRoot);
	if (result.status !== 0) {
		const error = result.error?.message || String(result.stderr || "").trim();
		if (result.status === 1 && !error) return null;
		return { error: error || `git exited with status ${result.status}` };
	}
	const output = String(result.stdout || "").replace(/\r?\n$/, "");
	const separator = output.indexOf("\t");
	return separator === -1
		? { scope: "unknown", value: output }
		: { scope: output.slice(0, separator), value: output.slice(separator + 1) };
}

/**
 * @param {{ apply: boolean, repoRoot?: string }} options `apply` wires the config when
 *   it is absent; `--check` (apply: false) only reports.
 */
function ensureDevHooks(options = {}) {
	const repoRoot = options.repoRoot || ROOT;
	const report = { skipped: false, reason: "", configured: null, changed: false, problems: [] };

	if (runGit(["rev-parse", "--git-dir"], repoRoot).status !== 0) {
		// Not a checkout (installed from the registry, or a plain directory): never fail.
		report.skipped = true;
		report.reason = "not a git repository";
		return report;
	}
	if (!fs.existsSync(path.join(repoRoot, HOOKS_DIR))) {
		report.skipped = true;
		report.reason = `no ${HOOKS_DIR}/ directory`;
		return report;
	}

	const current = effectiveHooksPath(repoRoot);
	if (current?.error) {
		report.problems.push(`unable to read core.hooksPath: ${current.error}`);
		return report;
	}
	const configured = current?.value ?? null;
	report.configured = configured;
	report.scope = current?.scope ?? null;

	if (configured === HOOKS_DIR) return report;

	if (configured === null) {
		if (!options.apply) {
			report.problems.push(
				`core.hooksPath is unset, so the ${HOOKS_DIR}/ hooks never run. Fix: npm run dev:hooks:install`,
			);
			return report;
		}
		const set = runGit(["config", "--local", "core.hooksPath", HOOKS_DIR], repoRoot);
		if (set.status !== 0) {
			report.problems.push(`unable to set core.hooksPath: ${String(set.stderr || "").trim()}`);
			return report;
		}
		report.changed = true;
		report.configured = HOOKS_DIR;
		report.scope = "local";
		return report;
	}

	// Something else owns hooksPath (another hook manager). That is a deliberate choice
	// by the user or a tool: report it, but neither overwrite it nor fail an install.
	report.problems.push(
		`core.hooksPath is "${configured}" at ${report.scope} scope, not "${HOOKS_DIR}", so the repo-local hooks are not running. ` +
			`Set a repo-local override with: npm run dev:hooks:install`,
	);
	return report;
}

function main(argv = process.argv.slice(2), repoRoot = ROOT) {
	const check = argv.includes("--check");
	if (argv.length > 0 && !check) {
		console.error("Usage: ensure-dev-hooks.js [--check]");
		return 2;
	}
	const report = ensureDevHooks({ apply: !check, repoRoot });

	// Everything goes to stderr: `npm install` and `npm pack` both run this through
	// `prepare`, and stdout there is a protocol channel - a stray log line breaks the
	// JSON that `npm pack --json` emits (tests/integration/dsh-bundle.test.js reads it).
	const say = (line) => console.error(line);

	if (report.skipped) {
		say(`Dev hooks wiring skipped: ${report.reason}.`);
		return 0;
	}
	if (report.changed) {
		say(`Wired core.hooksPath to ${HOOKS_DIR}: the pre-commit identity gate is live.`);
	}
	for (const problem of report.problems) say(`Dev hooks wiring: ${problem}`);
	if (report.problems.length > 0 && check) return 1;
	if (!report.changed && report.problems.length === 0) {
		say(`Dev hooks wiring OK: core.hooksPath = ${report.configured}.`);
	}
	return 0;
}
if (require.main === module) {
	process.exitCode = main();
}

module.exports = { HOOKS_DIR, ensureDevHooks, main };
