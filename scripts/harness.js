#!/usr/bin/env node
"use strict";

const {
  acceptPlan,
  auditProject,
  bundleAdoptionArtifacts,
  compareAdoptionReports,
  dispatchAgentTask,
  doctor,
  gateAdoptionReport,
  generateAdoptionReport,
  inspectMaintenance,
  inspectProjectProfile,
  inspectTeamDistribution,
  inspectWorkflowPack,
  inspectTaskResult,
  installTeamDistribution,
  listAdoptionReports,
  parseArgs,
  pinTeamDistribution,
  proposeMaintenance,
  prepareTaskExecution,
  printResult,
  recordAgentReview,
  reviewPlan,
  rollbackTeamDistribution,
  scaffoldHarness,
  scaffoldPlan,
  scaffoldWiki,
  setAgentDispatchStatus,
  statusAdoptionReports,
  updateTeamDistribution,
  validateAdoptionReports,
  validatePlanGate,
  validateHandoff,
  writeAdoptionApplyPlan,
  writeAdoptionDecisionRecord,
  writeAdoptionNextActions,
  writeAdoptionSelectedFiles,
  writeAdoptionReportsIndex,
} = require("./lib/harness-core");

const COMMANDS = ["init", "audit", "wiki", "doctor", "handoff", "plan", "gate", "review", "accept", "pack", "profile", "task", "result", "agent", "team", "maintenance", "adoption"];
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
      `Usage: node scripts/harness.js ${command} --target <repo> ${options.join(" ")}`,
      "",
      commandSummary(command)
    ].join("\n");
  }

  return [
    "Usage: node scripts/harness.js <command> --target <repo> [--json]",
    "",
    `Commands: ${COMMANDS.join(", ")}`,
    "Run `node scripts/harness.js <command> --help` for command-specific options.",
    "",
    "Examples:",
    "  node scripts/harness.js init --target path/to/repo",
    "  node scripts/harness.js audit --target path/to/repo",
    "  node scripts/harness.js wiki --target path/to/repo",
    "  node scripts/harness.js handoff --target path/to/repo",
    "  node scripts/harness.js doctor --target path/to/repo",
    "  node scripts/harness.js plan --target path/to/repo --feature F001 --title \"Small slice\"",
    "  node scripts/harness.js gate --target path/to/repo --plan docs/plans/F001-small-slice.md",
    "  node scripts/harness.js review --target path/to/repo --plan docs/plans/F001-small-slice.md",
    "  node scripts/harness.js accept --target path/to/repo --plan docs/plans/F001-small-slice.md",
    "  node scripts/harness.js pack inspect --file workflow-packs/safe-harness-bootstrap.pack.json",
    "  node scripts/harness.js profile inspect --file profiles/default.profile.json",
    "  node scripts/harness.js task prepare --target path/to/repo --plan docs/plans/F001-small-slice.md --task slice-1",
    "  node scripts/harness.js result inspect --target path/to/repo --task slice-1",
    "  node scripts/harness.js agent dispatch --target path/to/repo --task slice-1 --worker worker-a --reviewer reviewer-b",
    "  node scripts/harness.js team install --target path/to/repo --version 1.0.0 --preset safe-bootstrap",
    "  node scripts/harness.js maintenance inspect --target path/to/repo",
    "  node scripts/harness.js adoption report --target path/to/repo --output docs/examples/project-adoption-report.md",
    "  node scripts/harness.js adoption report --target path/to/repo --output-dir docs/examples",
    "  node scripts/harness.js adoption list --reports-dir docs/examples/adoptions",
    "  node scripts/harness.js adoption index --reports-dir docs/examples/adoptions --output docs/examples/adoptions-index.md",
    "  node scripts/harness.js adoption validate --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md",
    "  node scripts/harness.js adoption compare --reports-dir docs/examples/adoptions",
    "  node scripts/harness.js adoption gate --reports-dir docs/examples/adoptions",
    "  node scripts/harness.js adoption status --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md",
    "  node scripts/harness.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/stockagents-adoption-bundle",
    "  node scripts/harness.js adoption next-actions --bundle-dir docs/examples/stockagents-adoption-bundle --output docs/examples/stockagents-adoption-next-actions.md",
    "  node scripts/harness.js adoption decision-record --bundle-dir docs/examples/stockagents-adoption-bundle --output docs/examples/stockagents-adoption-decision-record.md",
    "  node scripts/harness.js adoption selected-files --bundle-dir docs/examples/stockagents-adoption-bundle --output docs/examples/stockagents-adoption-selected-files.md --include AGENTS.md"
  ].join("\n");
}

function commandSummary(command) {
  if (command === "init") {
    return "Create missing Harness files without overwriting existing files. Supports --dry-run.";
  }
  if (command === "audit") {
    return "Inspect an existing project without writing files. Supports --summary for bounded text output.";
  }
  if (command === "wiki") {
    return "Create missing Wiki starter files, skip existing files, then validate links. Supports --dry-run.";
  }
  if (command === "handoff") {
    return "Validate session-handoff.md required V1 sections.";
  }
  if (command === "doctor") {
    return "Run Harness guardrail checks and target classification.";
  }
  if (command === "plan") {
    return "Create a feature-linked vertical-slice plan without overwriting existing files. Supports --dry-run.";
  }
  if (command === "gate") {
    return "Validate that a plan is tied to feature state and has user confirmation.";
  }
  if (command === "review") {
    return "Review a plan against static Harness standards and release-readiness checks.";
  }
  if (command === "accept") {
    return "Accept a reviewed plan and append a Harness evolution record.";
  }
  if (command === "pack") {
    return "Inspect or validate declarative workflow packs without executing them.";
  }
  if (command === "profile") {
    return "Inspect declarative project profiles.";
  }
  if (command === "task") {
    return "Prepare isolated task ledger, evidence, replay, and worktree artifacts.";
  }
  if (command === "result") {
    return "Inspect replayable task result artifacts without relying on chat history.";
  }
  if (command === "agent") {
    return "Create and control auditable worker/reviewer dispatch records without executing agent work.";
  }
  if (command === "team") {
    return "Inspect, install, pin, update, and roll back local team distribution metadata.";
  }
  if (command === "maintenance") {
    return "Inspect stale docs, wiki lint readiness, upgrade guidance, drift, and reviewable maintenance proposals.";
  }
  if (command === "adoption") {
    return [
      "Generate, list, or index safe adoption report artifacts without modifying target projects.",
      "",
      "Examples:",
      "  node scripts/harness.js adoption report --target path/to/repo --output docs/examples/project-adoption-report.md",
      "  node scripts/harness.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/project-adoption-bundle",
      "  node scripts/harness.js adoption next-actions --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-next-actions.md",
      "  node scripts/harness.js adoption decision-record --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-decision-record.md",
      "  node scripts/harness.js adoption apply-plan --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-apply-plan.md --dry-run",
      "  node scripts/harness.js adoption selected-files --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-selected-files.md --include AGENTS.md"
    ].join("\n");
  }
  return "Run Coding Harness command.";
}

function run(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
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

  let result;
  if (command === "init") {
    result = scaffoldHarness(args.target, { dryRun: args.dryRun });
  } else if (command === "audit") {
    result = auditProject(args.target);
  } else if (command === "wiki") {
    result = scaffoldWiki(args.target, { dryRun: args.dryRun });
  } else if (command === "handoff") {
    result = validateHandoff(args.target);
  } else if (command === "plan") {
    result = scaffoldPlan(args.target, { feature: args.feature, title: args.title, dryRun: args.dryRun });
  } else if (command === "gate") {
    result = validatePlanGate(args.target, args.plan);
  } else if (command === "review") {
    result = reviewPlan(args.target, args.plan);
  } else if (command === "accept") {
    result = acceptPlan(args.target, args.plan);
  } else if (command === "pack") {
    const action = args._ && args._[0];
    if (action !== "inspect" && action !== "validate") {
      result = { target: args.target, errors: ["pack requires inspect or validate."], warnings: [] };
    } else {
      result = inspectWorkflowPack(args.file || "");
      if (action === "validate") {
        result.valid = result.errors.length === 0;
      }
    }
  } else if (command === "profile") {
    const action = args._ && args._[0];
    if (action !== "inspect") {
      result = { target: args.target, errors: ["profile requires inspect."], warnings: [] };
    } else {
      result = inspectProjectProfile(args.file || "");
    }
  } else if (command === "task") {
    const action = args._ && args._[0];
    if (action !== "prepare") {
      result = { target: args.target, errors: ["task requires prepare."], warnings: [] };
    } else {
      result = prepareTaskExecution(args.target, args.plan, args.task, args);
    }
  } else if (command === "result") {
    const action = args._ && args._[0];
    if (action !== "inspect") {
      result = { target: args.target, errors: ["result requires inspect."], warnings: [] };
    } else {
      result = inspectTaskResult(args.target, args.task);
    }
  } else if (command === "agent") {
    const action = args._ && args._[0];
    if (action === "dispatch") {
      result = dispatchAgentTask(args.target, args);
    } else if (action === "stop") {
      result = setAgentDispatchStatus(args.target, args.task, "stopped");
    } else if (action === "resume") {
      result = setAgentDispatchStatus(args.target, args.task, "dispatched");
    } else if (action === "review") {
      result = recordAgentReview(args.target, args);
    } else {
      result = { target: args.target, errors: ["agent requires dispatch, stop, resume, or review."], warnings: [] };
    }
  } else if (command === "team") {
    const action = args._ && args._[0];
    if (action === "inspect") {
      result = inspectTeamDistribution(args.target, args);
    } else if (action === "install") {
      result = installTeamDistribution(args.target, args);
    } else if (action === "pin") {
      result = pinTeamDistribution(args.target, args);
    } else if (action === "update") {
      result = updateTeamDistribution(args.target, args);
    } else if (action === "rollback") {
      result = rollbackTeamDistribution(args.target, args);
    } else {
      result = { target: args.target, errors: ["team requires inspect, install, pin, update, or rollback."], warnings: [] };
    }
  } else if (command === "maintenance") {
    const action = args._ && args._[0];
    if (action === "inspect") {
      result = inspectMaintenance(args.target, args);
    } else if (action === "propose") {
      result = proposeMaintenance(args.target, args);
    } else {
      result = { target: args.target, errors: ["maintenance requires inspect or propose."], warnings: [] };
    }
  } else if (command === "adoption") {
    const action = args._ && args._[0];
    if (action === "report") {
      result = generateAdoptionReport(args.target, args);
    } else if (action === "list") {
      result = listAdoptionReports(args);
    } else if (action === "index") {
      result = writeAdoptionReportsIndex(args);
    } else if (action === "validate") {
      result = validateAdoptionReports(args);
    } else if (action === "compare") {
      result = compareAdoptionReports(args);
    } else if (action === "gate") {
      result = gateAdoptionReport(args);
    } else if (action === "status") {
      result = statusAdoptionReports(args);
    } else if (action === "bundle") {
      result = bundleAdoptionArtifacts(args);
    } else if (action === "next-actions") {
      result = writeAdoptionNextActions(args);
    } else if (action === "decision-record") {
      result = writeAdoptionDecisionRecord(args);
    } else if (action === "apply-plan") {
      result = writeAdoptionApplyPlan(args);
    } else if (action === "selected-files") {
      result = writeAdoptionSelectedFiles(args);
    } else {
      result = { target: args.target, errors: ["adoption requires report, list, index, validate, compare, gate, status, bundle, next-actions, decision-record, apply-plan, or selected-files."], warnings: [] };
    }
  } else {
    result = doctor(args.target);
  }

  printResult(result, { json: args.json, summary: args.summary });
  return Array.isArray(result.errors) && result.errors.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = run();
}

module.exports = { run, usage };
