#!/usr/bin/env node
"use strict";

/**
 * Release automation script — bumps version, creates tag, publishes to npm,
 * and creates a GitHub release.
 *
 * Usage: node scripts/release.sh [patch|minor|major|1.0.0]
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PKG_PATH = path.join(ROOT, "package.json");

function run(cmd, opts = {}) {
	console.log(`  $ ${cmd}`);
	const result = execSync(cmd, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
		...opts,
	});
	return result.trim();
}

function bumpVersion(currentVersion, bump) {
	const parts = currentVersion.split(".").map(Number);
	if (bump === "major") {
		parts[0]++;
		parts[1] = 0;
		parts[2] = 0;
	} else if (bump === "minor") {
		parts[1]++;
		parts[2] = 0;
	} else if (bump === "patch") {
		parts[2]++;
	} else if (/^\d+\.\d+\.\d+$/.test(bump)) {
		return bump;
	} else {
		throw new Error(`Invalid bump type: ${bump}. Use major, minor, patch, or explicit version.`);
	}
	return parts.join(".");
}

function release(bumpType = "minor") {
	console.log("=== Amber Protocol Release ===\n");

	// 1. Pre-flight checks
	console.log("1. Pre-flight checks...");
	const branch = run("git branch --show-current");
	console.log(`   Branch: ${branch}`);

	const status = run("git status --porcelain");
	if (status) {
		console.error("   ERROR: Working directory is not clean. Commit or stash changes first.");
		process.exit(1);
	}
	console.log("   ✅ Working directory clean");

	// 2. Run tests
	console.log("\n2. Running tests...");
	try {
		run("node --test 2>&1", { timeout: 120000 });
		console.log("   ✅ Tests pass");
	} catch (e) {
		console.error("   ❌ Tests failed. Fix before releasing.");
		if (e.stdout) console.log(e.stdout);
		if (e.stderr) console.error(e.stderr);
		process.exit(1);
	}

	// 3. Version bump
	console.log("\n3. Bumping version...");
	const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
	const oldVersion = pkg.version;
	const newVersion = bumpVersion(oldVersion, bumpType);
	pkg.version = newVersion;
	fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
	console.log(`   ${oldVersion} → ${newVersion}`);

	// 4. Commit version bump
	console.log("\n4. Committing version bump...");
	run(`git add package.json`);
	run(`git commit -m "chore: bump to v${newVersion}"`);
	console.log("   ✅ Committed");

	// 5. Create git tag
	console.log("\n5. Creating git tag...");
	const tagMessage = `v${newVersion} - Phase B GA Release

See CHANGELOG.md for details.`;
	run(`git tag -a v${newVersion} -m "${tagMessage.replace(/"/g, '\\"')}"`);
	console.log(`   ✅ Tag v${newVersion} created`);

	// 6. Push to origin (optional, confirmed by user)
	console.log("\n6. Ready to push...");
	console.log(`   Run: git push origin ${branch} --tags`);

	// 7. npm publish instructions
	console.log("\n7. npm publish...");
	console.log("   Dry-run first:");
	console.log("   $ npm publish --dry-run");
	console.log("\n   Then publish:");
	console.log("   $ npm publish");

	// 8. GitHub release instructions
	console.log("\n8. GitHub Release...");
	console.log(`   Tag v${newVersion} is ready; create the release in your hosting platform.`);
	console.log("   - Title: Amber Protocol Phase B v" + newVersion);
	console.log("   - Attach: CHANGELOG.md");
	console.log("   - Mark as: Latest release");

	console.log("\n=== Release preparation complete ===");
	return newVersion;
}

// CLI
const bumpType = process.argv[2] || "minor";
if (bumpType === "--help" || bumpType === "-h") {
	console.log("Usage: node scripts/release.js [major|minor|patch|X.Y.Z]");
	console.log("  major  1.0.0 → 2.0.0");
	console.log("  minor  1.0.0 → 1.1.0");
	console.log("  patch  1.0.0 → 1.0.1");
	console.log("  X.Y.Z  Set exact version");
	process.exit(0);
}

if (require.main === module) {
	try {
		release(bumpType);
	} catch (e) {
		console.error("ERROR:", e.message);
		process.exit(1);
	}
}
