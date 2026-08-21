#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
	loadFixtureFamily,
	resolveTargetRelativePath,
	validateFixtureFamily,
} = require("./lib/distributed-governance-fixture-family");
const { loadRegistry } = require("./lib/distributed-governance-contract-registry");

function parseArgs(argv) {
	const args = { target: ".", json: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--target") {
			index += 1;
			if (index >= argv.length) {
				throw new Error("--target requires a repository path");
			}
			args.target = argv[index];
		} else if (arg === "--json") {
			args.json = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const targetRoot = path.resolve(args.target);
	const fixtureFamilyPath = resolveTargetRelativePath(
		targetRoot,
		path.join("docs", "architecture", "distributed-governance-fixture-family.json"),
	);
	const fixtureFamily = loadFixtureFamily(fixtureFamilyPath);
	const registryPath = resolveTargetRelativePath(targetRoot, fixtureFamily.sourceRegistry);
	const registry = loadRegistry(registryPath);
	const result = validateFixtureFamily(fixtureFamily, registry);

	if (args.json) {
		console.log(JSON.stringify({ ...result, fixtureFamilyPath, registryPath }, null, "\t"));
	} else if (result.valid) {
		console.log("Fixture family validation passed.");
	} else {
		console.error("Fixture family validation failed:");
		for (const error of result.errors) {
			console.error(`- ${error}`);
		}
	}

	if (!result.valid) {
		process.exitCode = 1;
	}
}

if (require.main === module) {
	main();
}

module.exports = { parseArgs };
