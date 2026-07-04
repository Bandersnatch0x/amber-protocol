#!/usr/bin/env node
"use strict";

const { parseArgs, printResult } = require("./lib/core/cli-output");
const { auditProject } = require("./lib/core/audit");

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/audit-project.js --target <repo> [--json]");
    return;
  }

  printResult(auditProject(args.target), { json: args.json });
}

if (require.main === module) {
  main();
}
