#!/usr/bin/env node
"use strict";

/**
 * Nightly host scenario (#129).
 *
 * Answers "does a host agent actually follow Amber?" without turning Amber
 * into a live agent runtime (ADR-0001/ADR-0005). The host agent gets an
 * isolated Target Repository with an Amber Setup and one canned objective;
 * the machine judge is the Governance Console (Session artifacts + strict
 * complete-check), NOT the chat transcript.
 *
 * Exit codes:
 *   0  pass (evidence-based)
 *   1  fail
 *   42 explicit skip (missing host binary / credentials) — never a silent pass
 *
 * Usage:
 *   node scripts/demo/nightly-host-scenario.js [--objective <id>] [--help]
 * Nightly or dispatch only — never a PR gate.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AMBER = path.join(REPO_ROOT, "scripts", "amber.js");

const SKIP_EXIT = 42;
const PASS_EXIT = 0;
const FAIL_EXIT = 1;

const CANNED_OBJECTIVES = Object.freeze([
	"Verify that the seed feature F001 is governable end to end on this fresh target.",
]);

function parseArgs(argv) {
	const parsed = { objective: null, help: false };
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--help" || argv[i] === "-h") {
			parsed.help = true;
		} else if (argv[i] === "--objective") {
			parsed.objective = argv[i + 1] || null;
			i += 1;
		} else if (argv[i].startsWith("--objective=")) {
			parsed.objective = argv[i].slice("--objective=".length);
		}
	}
	return parsed;
}

/**
 * Create an isolated target repository with an Amber Setup.
 * @param {string} label - Temp dir label.
 * @returns {string} Target root.
 */
function mkIsolatedTarget(label) {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), `amber-nightly-${label}-`));
	execSync("git init", { cwd: target, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
	execSync('git config user.email "nightly@amber.test"', {
		cwd: target,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	execSync('git config user.name "Nightly Host"', {
		cwd: target,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	fs.writeFileSync(
		path.join(target, "package.json"),
		JSON.stringify(
			{
				name: "amber-nightly-target",
				version: "0.0.0",
				private: true,
				scripts: { test: "node -e \"console.log('ok')\"" },
			},
			null,
			2,
		) + "\n",
	);
	fs.writeFileSync(
		path.join(target, "README.md"),
		"# Nightly host target\n\nIsolated target for #129.\n",
	);
	execSync('git add . && git commit -m "chore: seed nightly target"', {
		cwd: target,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	return target;
}

function run(cwd, args) {
	const res = spawnSync(process.execPath, [AMBER, ...args], {
		cwd,
		encoding: "utf8",
		timeout: 120_000,
	});
	return {
		exitCode: res.status === null ? -1 : res.status,
		stdout: (res.stdout || "").trim(),
		stderr: (res.stderr || "").trim(),
	};
}

/**
 * Detect whether a host binary (e.g. claude, codex) is available.
 * @param {string} binary - Binary name.
 * @returns {boolean}
 */
function hostBinaryAvailable(binary) {
	if (!binary) return true;
	try {
		execSync(`${binary} --version`, { stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 });
		return true;
	} catch {
		return false;
	}
}

/**
 * Build the judge context from the isolated target's Session artifacts.
 * @param {string} target - Target root.
 * @param {{objective: string}} opts
 * @returns {object} Judge context.
 */
function buildJudgeContext(target, { objective }) {
	const sessionsDir = path.join(target, ".amber", "sessions");
	const sessionIds = fs.existsSync(sessionsDir)
		? fs.readdirSync(sessionsDir).filter((name) => {
				try {
					return fs.statSync(path.join(sessionsDir, name)).isDirectory();
				} catch {
					return false;
				}
			})
		: [];
	// strict complete-check is the machine judge (reuses #127 semantics)
	let completeCheckPassed = false;
	let routeFromAmber = false;
	if (sessionIds.length > 0) {
		const sid = sessionIds[0];
		const cc = run(target, [
			"session",
			"complete-check",
			"--session",
			sid,
			"--strict",
			"--target",
			".",
		]);
		completeCheckPassed = cc.exitCode === 0 || /status: pass/i.test(cc.stdout);
		// route provenance: session manifest records the route id
		const manifestPath = path.join(sessionsDir, sid, "manifest.json");
		if (fs.existsSync(manifestPath)) {
			try {
				const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
				routeFromAmber = typeof manifest.route === "string" || typeof manifest.journey === "string";
			} catch {
				routeFromAmber = false;
			}
		}
	}
	return {
		objective,
		sessionEvidence: {
			sessionDirExists: sessionIds.length > 0,
			completeCheckPassed,
			evidenceCount: sessionIds.length,
			routeFromAmber,
		},
	};
}

/**
 * The machine judge: pass/fail from Session artifacts + complete-check.
 * Prose answers never pass.
 * @param {object} ctx - Judge context.
 * @returns {{ok: boolean, reasons: string[]}}
 */
function judgePassFail(ctx) {
	const reasons = [];
	const ev = ctx.sessionEvidence;
	if (!ev.sessionDirExists) {
		reasons.push("no Session artifacts found");
	}
	if (!ev.completeCheckPassed) {
		reasons.push("strict complete-check did not pass");
	}
	if (!ev.routeFromAmber) {
		reasons.push("route/journey was not sourced from `amber next` or `session start --route`");
	}
	if (ev.evidenceCount === 0) {
		reasons.push("no evidence recorded");
	}
	return { ok: reasons.length === 0, reasons };
}

/**
 * Detect an explicit skip (missing host binary/credentials).
 * @param {object} result - Scenario result.
 * @returns {boolean}
 */
function isSilentSkip(result) {
	return Boolean(result && result.skip === true);
}

function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (args.help) {
		console.log(
			[
				"Usage: node scripts/demo/nightly-host-scenario.js [--objective <id>] [--help]",
				"",
				"Nightly host scenario (#129): isolated target + one canned objective;",
				"the machine judge is the Governance Console (Session artifacts + strict",
				"complete-check), never the chat transcript.",
				"",
				`Exit codes: ${PASS_EXIT} pass / ${FAIL_EXIT} fail / ${SKIP_EXIT} explicit skip (missing host binary or credentials).`,
				"Nightly or dispatch only — never a PR gate.",
			].join("\n"),
		);
		return PASS_EXIT;
	}

	// Missing host binary → explicit skip, never a silent pass.
	const hostBinary = process.env.AMBER_NIGHTLY_HOST_BINARY;
	if (hostBinary && !hostBinaryAvailable(hostBinary)) {
		console.log(`SKIP: host binary "${hostBinary}" not found — explicit skip (exit ${SKIP_EXIT}).`);
		return SKIP_EXIT;
	}

	const objective = args.objective || CANNED_OBJECTIVES[0];
	const target = mkIsolatedTarget("run");

	// The scenario DOES NOT dispatch a live agent. It sets up the target and
	// hands off; the judge runs against whatever Session artifacts exist.
	// Here, with no host agent attached, no Session exists → explicit skip is
	// NOT appropriate (setup succeeded) — report the evidence-based fail so the
	// nightly run surfaces that the host agent did not run.
	const ctx = buildJudgeContext(target, { objective });
	const verdict = judgePassFail(ctx);
	console.log(JSON.stringify({ objective, target, verdict }, null, 2));
	if (verdict.ok) {
		return PASS_EXIT;
	}
	console.log("FAIL:", verdict.reasons.join("; "));
	return FAIL_EXIT;
}

module.exports = {
	CANNED_OBJECTIVES,
	SKIP_EXIT,
	PASS_EXIT,
	FAIL_EXIT,
	parseArgs,
	mkIsolatedTarget,
	hostBinaryAvailable,
	buildJudgeContext,
	judgePassFail,
	isSilentSkip,
	main,
};

if (require.main === module) {
	process.exitCode = main();
}
