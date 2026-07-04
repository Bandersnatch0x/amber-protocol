#!/usr/bin/env node
"use strict";

const { parseArgs, printResult } = require("./lib/core/cli-output");
const { scaffoldHarness } = require("./lib/core/scaffold");

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/scaffold-amber.js --target <repo> [--dry-run] [--json]");
    return;
  }

  const result = scaffoldHarness(args.target, { dryRun: args.dryRun });
  printResult(result, { json: args.json });
}

if (require.main === module) {
  main();
}
