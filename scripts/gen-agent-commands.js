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
		if (result.changed) {
			console.error("Agent command files are stale. Run: npm run gen:agents");
			for (const file of result.stale) {
				console.error(`  stale: ${file}`);
			}
			return 1;
		}
		console.log(
			`Agent command files up to date (${result.written.length} files).`,
		);
		return 0;
	}

	console.log(`Generated ${result.written.length} agent command files:`);
	for (const file of result.written) {
		console.log(`  ${file}`);
	}
	return 0;
}

if (require.main === module) {
	process.exitCode = main();
}

module.exports = { main };
