#!/usr/bin/env node
"use strict";

/**
 * npm publish wrapper — verifies package contents and publishes.
 *
 * Usage: node scripts/publish.js [--dry-run]
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PKG_PATH = path.join(ROOT, "package.json");

function run(cmd, opts = {}) {
	console.log(`  $ ${cmd}`);
	try {
		const result = execSync(cmd, {
			cwd: ROOT,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			...opts,
		});
		return result.trim();
	} catch (e) {
		console.error(`  ERROR: ${e.stderr || e.message}`);
		throw e;
	}
}

function publish(options = {}) {
	const dryRun = options.dryRun || process.argv.includes("--dry-run");
	const version = JSON.parse(fs.readFileSync(PKG_PATH, "utf8")).version;

	console.log(`=== npm Publish v${version} ===\n`);

	// 1. Verify package contents
	console.log("1. Packing to verify contents...");
	const packOutput = run("npm pack --dry-run 2>&1");
	console.log(
		packOutput
			.split("\n")
			.map((l) => `   ${l}`)
			.join("\n"),
	);

	// Check for required files
	const requiredFiles = [
		"package.json",
		"README.md",
		"scripts/harness.js",
		"scripts/lib/",
		"schemas/",
		"templates/",
	];
	for (const file of requiredFiles) {
		if (packOutput.includes(file)) {
			console.log(`   ✅ ${file}`);
		} else {
			console.log(`   ⚠️  Missing: ${file}`);
		}
	}

	// 2. Publish
	if (dryRun) {
		console.log("\n2. DRY RUN — would publish v" + version);
	} else {
		console.log("\n2. Publishing to npm...");
		run("npm publish --access public");
		console.log(`   ✅ Published v${version} to npm`);
	}

	// 3. Verify on registry
	if (!dryRun) {
		console.log("\n3. Verifying on registry...");
		try {
			const info = run(`npm view coding-harness version 2>&1`);
			if (info === version) {
				console.log(`   ✅ npm registry shows v${version}`);
			} else {
				console.log(`   ⚠️  Registry shows ${info}, expected ${version}`);
			}
		} catch (e) {
			console.log(
				"   ℹ️  Verification skipped (may take a moment to propagate)",
			);
		}
	}

	console.log("\n=== Publish complete ===");
}

if (require.main === module) {
	publish();
}
