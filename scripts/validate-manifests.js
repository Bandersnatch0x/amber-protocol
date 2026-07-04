#!/usr/bin/env node
"use strict";

const { parseArgs, printResult } = require("./lib/core/cli-output");
const { validateManifests } = require("./lib/core/manifests");

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/validate-manifests.js --target <plugin-repo> [--json]");
    return;
  }

  const result = validateManifests(args.target);
  printResult(result, { json: args.json });
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
