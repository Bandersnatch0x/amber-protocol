#!/usr/bin/env node
"use strict";

const { parseArgs, printResult } = require("./lib/amber-core");
const { commandSummary } = require("./lib/command-help");
const { dispatch } = require("./lib/command-dispatcher");

const COMMANDS = [
  "init",
  "audit",
  "wiki",
  "doctor",
  "handoff",
  "plan",
  "gate",
  "review",
  "accept",
  "pack",
  "profile",
  "task",
  "result",
  "agent",
  "team",
  "maintenance",
  "adoption",
  "loop",
  "route",
  "session",
  "migrate",
  "daemon",
  "governance",
  "execution",
  "security",
];
const DRY_RUN_COMMANDS = new Set(["init", "wiki", "plan"]);
const SUMMARY_COMMANDS = new Set(["audit"]);

function usage(command) {
  if (command && COMMANDS.includes(command)) {
    const options = ["[--json]"];
    if (DRY_RUN_COMMANDS.has(command)) {
      options.push("[--dry-run]");
    }
    if (SUMMARY_COMMANDS.has(command)) {
      options.push("[--summary]");
    }

    return [
      `Usage: node scripts/amber.js ${command} --target <repo> ${options.join(" ")}`,
      "",
      commandSummary(command),
    ].join("\n");
  }

  return [
    "Usage: node scripts/amber.js <command> --target <repo> [--json]",
    "",
    `Commands: ${COMMANDS.join(", ")}`,
    "Run `node scripts/amber.js <command> --help` for command-specific options.",
    "",
    "Examples:",
    "  node scripts/amber.js init --target path/to/repo",
    "  node scripts/amber.js audit --target path/to/repo",
    "  node scripts/amber.js wiki --target path/to/repo",
    "  node scripts/amber.js handoff --target path/to/repo",
    "  node scripts/amber.js doctor --target path/to/repo",
    '  node scripts/amber.js plan --target path/to/repo --feature F001 --title "Small slice"',
    "  node scripts/amber.js gate --target path/to/repo --plan docs/plans/F001-small-slice.md",
    "  node scripts/amber.js review --target path/to/repo --plan docs/plans/F001-small-slice.md",
    "  node scripts/amber.js accept --target path/to/repo --plan docs/plans/F001-small-slice.md",
    "  node scripts/amber.js pack inspect --file workflow-packs/safe-amber-bootstrap.pack.json",
    "  node scripts/amber.js pack readiness --file workflow-packs/safe-amber-bootstrap.pack.json --json",
    "  node scripts/amber.js pack validate-execution --file workflow-packs/safe-amber-bootstrap.pack.json --json",
    "  node scripts/amber.js profile inspect --file profiles/default.profile.json",
    "  node scripts/amber.js task prepare --target path/to/repo --plan docs/plans/F001-small-slice.md --task slice-1",
    "  node scripts/amber.js result inspect --target path/to/repo --task slice-1",
    "  node scripts/amber.js agent dispatch --target path/to/repo --task slice-1 --worker worker-a --reviewer reviewer-b",
    "  node scripts/amber.js team install --target path/to/repo --version 1.0.0 --preset safe-bootstrap",
    "  node scripts/amber.js maintenance inspect --target path/to/repo",
    "  node scripts/amber.js adoption report --target path/to/repo --output docs/examples/project-adoption-report.md",
    "  node scripts/amber.js adoption report --target path/to/repo --output-dir docs/examples",
    "  node scripts/amber.js adoption list --reports-dir docs/examples/adoptions",
    "  node scripts/amber.js adoption index --reports-dir docs/examples/adoptions --output docs/examples/adoptions-index.md",
    "  node scripts/amber.js adoption validate --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md",
    "  node scripts/amber.js adoption compare --reports-dir docs/examples/adoptions",
    "  node scripts/amber.js adoption gate --reports-dir docs/examples/adoptions",
    "  node scripts/amber.js adoption status --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md",
    "  node scripts/amber.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/sample-adoption-bundle",
    "  node scripts/amber.js adoption next-actions --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-next-actions.md",
    "  node scripts/amber.js adoption decision-record --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-decision-record.md",
    "  node scripts/amber.js adoption selected-files --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-selected-files.md --include AGENTS.md",
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
    else console.log(resolved.text);
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
