#!/usr/bin/env node
"use strict";

const { parseArgs, printResult } = require("./lib/core/cli-output");
const { COMMANDS, commandSummary, commandUsageLine } = require("./lib/command-help");
const { dispatch } = require("./lib/command-dispatcher");

function usage(command) {
	if (command && COMMANDS.includes(command)) {
		const usageLine = commandUsageLine(command);

		return [usageLine, "", commandSummary(command)].join("\n");
	}

	return [
		"Usage: amber <command> --target <repo> [--json]",
		"",
		`Commands: ${COMMANDS.join(", ")}`,
		"Run `amber <command> --help` for command-specific options.",
		"",
		"Examples:",
		"  amber init --target path/to/repo",
		"  amber audit --target path/to/repo",
		"  amber wiki --target path/to/repo",
		"  amber wiki knowledge plan --target path/to/repo",
		"  amber wiki knowledge build --target path/to/repo",
		"  amber handoff --target path/to/repo",
		"  amber handoff bundle --target path/to/repo",
		"  amber handoff validate --target path/to/repo",
		"  amber doctor --target path/to/repo",
		"  amber governance report --target path/to/repo",
		'  amber plan --target path/to/repo --feature F001 --title "Small slice"',
		"  amber gate --target path/to/repo --plan docs/plans/F001-small-slice.md",
		"  amber review --target path/to/repo --plan docs/plans/F001-small-slice.md",
		"  amber accept --target path/to/repo --plan docs/plans/F001-small-slice.md",
		"  amber pack inspect --file workflow-packs/safe-amber-bootstrap.pack.json",
		"  amber pack readiness --file workflow-packs/safe-amber-bootstrap.pack.json --json",
		"  amber pack validate-execution --file workflow-packs/safe-amber-bootstrap.pack.json --json",
		"  amber profile inspect --file profiles/default.profile.json",
		"  amber task prepare --target path/to/repo --plan docs/plans/F001-small-slice.md --task slice-1",
		"  amber result inspect --target path/to/repo --task slice-1",
		"  amber agent dispatch --target path/to/repo --task slice-1 --worker worker-a --reviewer reviewer-b",
		"  amber team install --target path/to/repo --version 1.0.0 --preset safe-bootstrap --dry-run --json",
		"  amber maintenance inspect --target path/to/repo --json",
		"  amber adoption report --target path/to/repo --output docs/examples/project-adoption-report.md",
		"  amber adoption report --target path/to/repo --output-dir docs/examples",
		"  amber adoption list --reports-dir docs/examples/adoptions",
		"  amber adoption index --reports-dir docs/examples/adoptions --output docs/examples/adoptions-index.md",
		"  amber adoption validate --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md",
		"  amber adoption compare --reports-dir docs/examples/adoptions",
		"  amber adoption gate --reports-dir docs/examples/adoptions",
		"  amber adoption status --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md",
		"  amber adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/sample-adoption-bundle",
		"  amber adoption next-actions --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-next-actions.md",
		"  amber adoption decision-record --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-decision-record.md",
		"  amber adoption selected-files --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-selected-files.md --include AGENTS.md",
	].join("\n");
}

async function run(argv = process.argv.slice(2)) {
	const [command, ...rest] = argv;

	if (!command || command === "--help" || command === "-h") {
		console.log(usage());
		return 0;
	}

	if (command === "--version" || command === "-v") {
		console.log(require("../package.json").version);
		return 0;
	}

	if (!COMMANDS.includes(command)) {
		console.error(`Unknown command: ${command}`);
		console.error(`Expected one of: ${COMMANDS.join(", ")}`);
		return 1;
	}

	const args = parseArgs(rest);
	if (args.help) {
		console.log(usage(command));
		return 0;
	}

	// Dispatch to registered handler — may return a Promise for async commands
	const dispatchResult = await dispatch(command, args);
	const { result: resolved, exitCode, bypassPrint, onBypass } = dispatchResult;

	if (bypassPrint) {
		if (onBypass) onBypass();
		else {
			console.log(resolved.text);
			if (Array.isArray(resolved.warnings) && resolved.warnings.length > 0) {
				console.log("");
				for (const w of resolved.warnings) console.log(`WARNING: ${w}`);
			}
			if (Array.isArray(resolved.errors) && resolved.errors.length > 0) {
				console.log("");
				for (const e of resolved.errors) console.log(`ERROR: ${e}`);
			}
		}
		return exitCode ?? 0;
	}

	printResult(resolved, { json: args.json, summary: args.summary });
	return Array.isArray(resolved.errors) && resolved.errors.length > 0 ? 1 : 0;
}

if (require.main === module) {
	run()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((err) => {
			console.error(err.message || err);
			process.exitCode = 1;
		});
}

module.exports = { run, usage, COMMANDS };
