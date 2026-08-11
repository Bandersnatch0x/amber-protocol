#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { parseArgs, printResult } = require("./lib/core/cli-output");
const { validateFeatureListFile } = require("./lib/core/validators");

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log("Usage: node scripts/validate-feature-list.js --target <repo> [--json]");
		return;
	}

	const target = path.resolve(args.target || process.cwd());
	const result = {
		target,
		...validateFeatureListFile(path.join(target, "feature_list.json")),
	};
	printResult(result, { json: args.json });
	if (result.errors.length > 0) {
		process.exitCode = 1;
	}
}

if (require.main === module) {
	main();
}
