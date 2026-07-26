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
	// (a)
	try {
		console.log("=== Amber Status ===");
		process.stdout.write(runCapture(SECTIONS[0].cmd, SECTIONS[0].args));
	} catch (err) {
		console.error(`amber status failed: ${err.message || err}`);
	}
	console.log("\n");

	// (b)
	try {
		console.log("=== Next-up Issues ===");
		process.stdout.write(runCapture(SECTIONS[1].cmd, SECTIONS[1].args));
	} catch (err) {
		console.error(
			`gh issue list failed (gh installed + auth + network?): ${err.message || err}`,
		);
	}
	console.log("\n");

	// (c)
	console.log("=== Git State ===");
	try {
		process.stdout.write(runCapture(GIT_PARTS[0].cmd, GIT_PARTS[0].args));
	} catch (err) {
		console.error(`git status failed: ${err.message || err}`);
	}
	console.log(""); // blank line between status and log for scannability
	try {
		process.stdout.write(runCapture(GIT_PARTS[1].cmd, GIT_PARTS[1].args));
	} catch (err) {
		console.error(`git log failed: ${err.message || err}`);
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
