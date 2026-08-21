#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
	loadRegistry,
	validateRegistry,
} = require("./lib/distributed-governance-contract-registry");

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
	const registryPath = path.resolve(
		args.target,
		"docs",
		"architecture",
		"distributed-governance-contract-registry.json",
	);
	const registry = loadRegistry(registryPath);
	const result = validateRegistry(registry);

	if (args.json) {
		console.log(JSON.stringify({ ...result, registryPath }, null, "\t"));
	} else if (result.valid) {
		console.log("Contract registry validation passed.");
	} else {
		console.error("Contract registry validation failed:");
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
