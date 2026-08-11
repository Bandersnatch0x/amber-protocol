#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { generateAgentCommands } = require("./lib/core/agent-commands");

function main(argv = process.argv.slice(2)) {
	const check = argv.includes("--check");
	const repoRoot = path.resolve(__dirname, "..");
	const skillsRoot = path.join(repoRoot, "skills");
	const result = generateAgentCommands({ skillsRoot, repoRoot, check });

	if (check) {
		if (result.changed.length > 0) {
			console.error("Agent command files are stale. Run: npm run gen:agents");
			for (const file of result.changed) {
				console.error(`  stale: ${file}`);
			}
			return 1;
		}
		console.log(`Agent command files up to date (${result.paths.length} files).`);
		return 0;
	}

	const current = result.paths.length - result.changed.length;
	console.log(
		`Agent command files: ${result.paths.length} total, ${result.changed.length} updated, ${current} already current.`,
	);
	for (const file of result.paths) {
		console.log(`  ${file}`);
	}
	return 0;
}

if (require.main === module) {
	process.exitCode = main();
}

module.exports = { main };
