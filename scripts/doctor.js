#!/usr/bin/env node
"use strict";

const { doctor, parseArgs, printResult } = require("./lib/amber-core");

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/doctor.js --target <repo> [--json]");
    return;
  }

  const result = doctor(args.target);
  printResult(result, { json: args.json });
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
