#!/usr/bin/env node
"use strict";

const { parseArgs, printResult } = require("./lib/core/cli-output");
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
  "status",
  "drift",
  "sync",
  "migrate",
  "governance",
  "execution",
  "security",
  "feature",
  "clean",
  "next",
  "explain",
  "hooks",
];
const DRY_RUN_COMMANDS = new Set(["init", "wiki", "plan"]);
const SUMMARY_COMMANDS = new Set(["audit"]);

// Per-command usage lines that override the generic "--target <repo>" template.
// Used for commands whose required parameters don't fit the default shape.
const PER_COMMAND_USAGE = {
  init: "Usage: amber init --target <repo> [--with-wiki] [--skip-detection] [--json] [--dry-run]",
  plan: "Usage: amber plan --target <repo> --feature <id> --title <title> [--json] [--dry-run]",
  team: [
    "Usage: amber team <inspect|install|pin|update|rollback> --target <repo> [--json]",
    "       amber team install --target <repo> --version <version> --preset <preset> [--dry-run] [--json]",
    "       amber team update --target <repo> --version <version> [--dry-run|--confirm] [--json]",
  ].join("\n"),
  gate: "Usage: amber gate --target <repo> --plan <relative-plan-path> [--confirm] [--json]",
  review: "Usage: amber review --target <repo> --plan <relative-plan-path> [--json]",
  accept: "Usage: amber accept --target <repo> --plan <relative-plan-path> [--session <id>] [--strict] [--json]",
  explain: "Usage: amber explain [<code>] [--markdown <path>] [--json]",
  hooks: "Usage: amber hooks <check|install|uninstall|status> --target <repo> [--warn-only] [--force] [--json]",
  loop: "Usage: amber loop <inspect|recommend|run|approve|verify-ledger|record|status|validate-loop> [--target <repo>] [--file <pack>] [--contract <id>] [--dry-run|--execute] [--reviewer <name>] [--json]",
  governance: [
    "Usage: amber governance <docs|evidence|policy|audit|readiness|standards|rules> [--target <repo>] [--json]",
    "       amber governance rules <init|inspect|check> --target <repo> [--command <cmd>]",
  ].join("\n"),
  route: "Usage: amber route <list|inspect|validate|test|approve|verify-ledger> <route-id> [--target <repo>] [--execute] [--stage <name>] [--reviewer <name>] [--json]",
  session: "Usage: amber session <start|status|list|abort|continue|complete-check|verify|approve|verify-ledger> [--target <repo>] [--session <id>] [--goal <goal>] [--json]",
  status: "Usage: amber status --target <repo> [--json]",
  drift: "Usage: amber drift --target <repo> [--scope artifact|wiki|scaffold|all] [--format text|json|gh-annotations] [--no-fail] [--json]",
  sync: "Usage: amber sync --target <repo> [--execute] [--json]",
};

function usage(command) {
  if (command && COMMANDS.includes(command)) {
    // Use the per-command override when it exists; otherwise build a generic line.
    let usageLine;
    if (PER_COMMAND_USAGE[command]) {
      usageLine = PER_COMMAND_USAGE[command];
    } else {
      const options = ["[--json]"];
      if (DRY_RUN_COMMANDS.has(command)) {
        options.push("[--dry-run]");
      }
      if (SUMMARY_COMMANDS.has(command)) {
        options.push("[--summary]");
      }
      usageLine = `Usage: amber ${command} --target <repo> ${options.join(" ")}`;
    }

    return [
      usageLine,
      "",
      commandSummary(command),
    ].join("\n");
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
    "  amber handoff --target path/to/repo",
    "  amber doctor --target path/to/repo",
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
