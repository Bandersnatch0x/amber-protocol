#!/usr/bin/env node
"use strict";

// F080 H7 detached worker. This process accepts ownership coordinates only;
// no job name, command, module, agent, workflow, or external target can be
// supplied. The closed runtime registry and every authority check stay in
// runtime-core.

const path = require("node:path");
const { runDaemonWorker } = require("./lib/harness/runtime-core");

function value(args, flag) {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}

async function main(argv = process.argv.slice(2)) {
	const target = value(argv, "--target");
	const pollMs = Number(value(argv, "--poll-ms"));
	const leaseId = value(argv, "--lease");
	const fence = Number(value(argv, "--fence"));
	if (!target || !Number.isInteger(pollMs) || !leaseId || !Number.isInteger(fence)) {
		process.exitCode = 2;
		return;
	}
	const result = await runDaemonWorker(path.resolve(target), { pollMs, leaseId, fence });
	process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
	main().catch(() => {
		process.exitCode = 1;
	});
}

module.exports = { main };
