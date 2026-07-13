"use strict";

// orient.js — one-command session-start orientation (issue #48).
// Sequentially runs:
//   (a) node scripts/amber.js status --target .
//   (b) gh issue list --repo Bandersnatch0x/amber-protocol --label next-up
//   (c) git status + git log --oneline -5
// Output is split into three scannable segments.
//
// Style: zero new dependencies, execFileSync, modeled directly on scripts/verify-release.js.
// Cross-platform: Windows cmd/PowerShell, Git-Bash, sh all work (assumes node/git/gh in PATH).
// Usage: node scripts/orient.js  or  npm run orient
//
// This dogfoods `amber status` as the canonical "what's next" entry point.

const { execFileSync } = require("node:child_process");

// Pure data for testability and clarity (no side effects).
const SECTIONS = [
	{
		key: "amber-status",
		title: "Amber Status",
		cmd: "node",
		args: ["scripts/amber.js", "status", "--target", "."],
	},
	{
		key: "next-up-issues",
		title: "Next-up Issues",
		cmd: "gh",
		args: ["issue", "list", "--repo", "Bandersnatch0x/amber-protocol", "--label", "next-up"],
	},
];

const GIT_PARTS = [
	{ label: "git status", cmd: "git", args: ["status"] },
	{ label: "git log --oneline -5", cmd: "git", args: ["log", "--oneline", "-5"] },
];

function runCapture(cmd, args) {
	return execFileSync(cmd, args, { encoding: "utf8" });
}

function main() {
	let statusText = "";
	let issuesText = "";
	let gitStatusText = "";
	let gitLogText = "";

	// (a)
	try {
		console.log("=== Amber Status ===");
		statusText = runCapture(SECTIONS[0].cmd, SECTIONS[0].args);
		process.stdout.write(statusText);
	} catch (err) {
		const msg = `amber status failed: ${err.message || err}`;
		console.error(msg);
		statusText = msg;
	}
	console.log("\n");

	// (b)
	try {
		console.log("=== Next-up Issues ===");
		issuesText = runCapture(SECTIONS[1].cmd, SECTIONS[1].args);
		process.stdout.write(issuesText);
	} catch (err) {
		const msg = `gh issue list failed (gh installed + auth + network?): ${err.message || err}`;
		console.error(msg);
		issuesText = msg;
	}
	console.log("\n");

	// (c)
	console.log("=== Git State ===");
	try {
		gitStatusText = runCapture(GIT_PARTS[0].cmd, GIT_PARTS[0].args);
		process.stdout.write(gitStatusText);
	} catch (err) {
		const msg = `git status failed: ${err.message || err}`;
		console.error(msg);
		gitStatusText = msg;
	}
	console.log(""); // blank line between status and log for scannability
	try {
		gitLogText = runCapture(GIT_PARTS[1].cmd, GIT_PARTS[1].args);
		process.stdout.write(gitLogText);
	} catch (err) {
		const msg = `git log failed: ${err.message || err}`;
		console.error(msg);
		gitLogText = msg;
	}

	return 0;
}

module.exports = {
	SECTIONS,
	GIT_PARTS,
	runCapture, // thin wrapper, exercised indirectly
};

if (require.main === module) {
	try {
		process.exit(main());
	} catch (err) {
		console.error(err && err.stack ? err.stack : err);
		process.exit(1);
	}
}
