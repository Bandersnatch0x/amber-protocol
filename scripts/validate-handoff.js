#!/usr/bin/env node
"use strict";

const { parseArgs, printResult, validateHandoff } = require("./lib/harness-core");

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/validate-handoff.js --target <repo> [--json]");
    return;
  }

  const result = validateHandoff(args.target);
  printResult(result, { json: args.json });
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
