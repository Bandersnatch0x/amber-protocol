"use strict";

/**
 * Command dispatcher for the Amber CLI.
 *
 * Replaces the monolithic if/else-if chain in amber.js with a lookup-table
 * pattern. Each command maps to a handler function that receives parsed args
 * and returns `{ result, exitCode }`. The dispatcher standardises the output
 * envelope (`{ target, errors, warnings, ... }`) so the CLI run() function
 * becomes a thin parser → dispatch → print pipeline.
 */

const path = require("node:path");

// ── Barrel imports ──────────────────────────────────────────────────────────
const amberCore = require("./amber-core");
const routeCommands = require("./route-commands");
const sessionCommands = require("./session-commands");
const featureCommands = require("./feature-commands");
const { migrateManifests } = require("./migrate-command");
const { migrateState, migrateWiki } = require("./state-migration");
const { validateWorkflowPack } = require("./core/execution-validator");

// ── Helpers ─────────────────────────────────────────────────────────────────

function unknownAction(command, actions) {
  return {
    target: undefined,
    errors: [`${command} requires ${actions.join(", ")}, or ${actions.pop()}.`],
    warnings: [],
  };
}

function resolveTarget(args) {
  return args.target || process.cwd();
}

// ── Simple command wrappers ─────────────────────────────────────────────────

function handleInit(args) {
  return {
    result: amberCore.scaffoldHarness(args.target, {
      dryRun: args.dryRun,
      withWiki: args.withWiki,
      skipDetection: args.skipDetection,
    }),
  };
}

function handleAudit(args) {
  return { result: amberCore.auditProject(args.target) };
}

function handleWiki(args) {
  const action = args._?.[0];
  if (action === "export") {
    return { result: amberCore.exportOkfBundle(args.target, { outputDir: args.outputDir }) };
  }
  if (args.okf) {
    return { result: amberCore.validateWiki(args.target, { okf: true }) };
  }
  return { result: amberCore.scaffoldWiki(args.target, { dryRun: args.dryRun }) };
}

function handleDoctor(args) {
  return { result: amberCore.doctor(args.target, { okf: args.okf }) };
}

function handleHandoff(args) {
  return { result: amberCore.validateHandoff(args.target) };
}

function handlePlan(args) {
  return {
    result: amberCore.scaffoldPlan(args.target, {
      feature: args.feature,
      title: args.title,
      dryRun: args.dryRun,
    }),
  };
}

function handleGate(args) {
  if (args.confirm) {
    return { result: amberCore.confirmPlanGate(args.target, args.plan) };
  }
  return { result: amberCore.validatePlanGate(args.target, args.plan) };
}

function handleReview(args) {
  return { result: amberCore.reviewPlan(args.target, args.plan) };
}

function handleAccept(args) {
  const acceptResult = amberCore.acceptPlan(args.target, args.plan);
  if (!args.session) return { result: acceptResult };

  const { buildCompletionResult } = require("./completion-check");
  const completion = buildCompletionResult(resolveTarget(args), args.session, args);
  return {
    result: {
      ...acceptResult,
      text: [acceptResult.text || "", completion.text].join("\n"),
      warnings: [...(acceptResult.warnings || []), ...completion.warnings],
      errors: [...(acceptResult.errors || []), ...completion.errors],
    },
  };
}

// ── Subcommand-driven command handlers ──────────────────────────────────────

function handlePack(args) {
  const action = args._?.[0];
  if (action === "inspect" || action === "validate") {
    const r = amberCore.inspectWorkflowPack(args.file || "");
    if (action === "validate") r.valid = r.errors.length === 0;
    return { result: r };
  }
  if (action === "readiness") {
    return { result: amberCore.inspectWorkflowPackReadiness(args.file || args._?.[1] || "") };
  }
  if (action === "validate-execution") {
    const packPath = args.file || args.pack || args._?.[1] || "";
    const v = validateWorkflowPack(packPath);
    return { result: { target: args.target, ...v, errors: v.errors || [], warnings: v.warnings || [] } };
  }
  return { result: unknownAction("pack", ["inspect", "validate", "readiness", "validate-execution"]) };
}

function handleProfile(args) {
  if (args._?.[0] !== "inspect") {
    return { result: unknownAction("profile", ["inspect"]) };
  }
  return { result: amberCore.inspectProjectProfile(args.file || "") };
}

function handleTask(args) {
  if (args._?.[0] !== "prepare") {
    return { result: unknownAction("task", ["prepare"]) };
  }
  return { result: amberCore.prepareTaskExecution(args.target, args.plan, args.task, args) };
}

function handleResult(args) {
  if (args._?.[0] !== "inspect") {
    return { result: unknownAction("result", ["inspect"]) };
  }
  return { result: amberCore.inspectTaskResult(args.target, args.task) };
}

function handleAgent(args) {
  const action = args._?.[0];
  if (action === "dispatch") return { result: amberCore.dispatchAgentTask(args.target, args) };
  if (action === "stop") return { result: amberCore.setAgentDispatchStatus(args.target, args.task, "stopped") };
  if (action === "resume") return { result: amberCore.setAgentDispatchStatus(args.target, args.task, "dispatched") };
  if (action === "review") return { result: amberCore.recordAgentReview(args.target, args) };
  return { result: unknownAction("agent", ["dispatch", "stop", "resume", "review"]) };
}

function handleLoop(args) {
  const action = args._?.[0];
  if (action === "inspect") {
    return { result: amberCore.inspectLoopContract({ file: args.file, contract: args.contract }) };
  }
  if (action === "run") {
    return { result: amberCore.dryRunLoopContract({ file: args.file, contract: args.contract, dryRun: args.dryRun, output: args.output }) };
  }
  if (action === "record") {
    return { result: amberCore.recordLoopContract({ file: args.file, contract: args.contract, triggerSource: args.triggerSource, stopReason: args.stopReason, output: args.output }) };
  }
  if (action === "status") {
    return { result: amberCore.inspectLoopLedger({ ledger: args.ledger }) };
  }
  if (action === "validate-loop") {
    return { result: amberCore.validateLoopContract(args.contract) };
  }
  return { result: unknownAction("loop", ["inspect", "run", "record", "status", "validate-loop"]) };
}

function handleTeam(args) {
  const action = args._?.[0];
  if (action === "inspect")  return { result: amberCore.inspectTeamDistribution(args.target, args) };
  if (action === "install")  return { result: amberCore.installTeamDistribution(args.target, args) };
  if (action === "pin")      return { result: amberCore.pinTeamDistribution(args.target, args) };
  if (action === "update")   return { result: amberCore.updateTeamDistribution(args.target, args) };
  if (action === "rollback") return { result: amberCore.rollbackTeamDistribution(args.target, args) };
  return { result: unknownAction("team", ["inspect", "install", "pin", "update", "rollback"]) };
}

function handleMaintenance(args) {
  const action = args._?.[0];
  if (action === "inspect")  return { result: amberCore.inspectMaintenance(args.target, args) };
  if (action === "propose" || action === "proposal") return { result: amberCore.proposeMaintenance(args.target, args) };

  // Actions that need lazy-loaded maintenance helpers
  const { resolveTarget: resolve } = require("./core/fs-utils");
  const targetRoot = resolve(args.target);

  if (action === "stale-docs") {
    const { detectStaleDocs } = require("./core/maintenance");
    const parsed = args.thresholdDays ? Number.parseInt(args.thresholdDays, 10) : undefined;
    const thresholdDays = Number.isInteger(parsed) ? parsed : undefined;
    const stale = detectStaleDocs(targetRoot, thresholdDays);
    return { result: { target: targetRoot, staleDocs: stale.staleDocs, thresholdDays: stale.thresholdDays, errors: [], warnings: [] } };
  }
  if (action === "wiki-lint") {
    const { validateWikiStructure, fixWikiMarkers } = require("./core/maintenance");
    let fixResult = null;
    if (args.fixMarkers) fixResult = fixWikiMarkers(targetRoot);
    const r = validateWikiStructure(targetRoot);
    if (fixResult) { r.fixedMarkers = fixResult.fixed; r.fixedMarkerCount = fixResult.fixedCount; }
    return { result: r };
  }
  if (action === "pack-drift") {
    const { detectPackDrift } = require("./core/maintenance");
    const { resolveRegistryPath } = require("./core/team");
    const drift = detectPackDrift(targetRoot, resolveRegistryPath(args.registry));
    return { result: { target: targetRoot, ...drift, errors: [], warnings: [] } };
  }
  if (action === "upgrade-preview") {
    const { previewUpgrade } = require("./core/maintenance");
    const { resolveRegistryPath } = require("./core/team");
    const preview = previewUpgrade(targetRoot, args.version, resolveRegistryPath(args.registry));
    return { result: { target: targetRoot, ...preview, errors: [], warnings: [] } };
  }
  if (action === "evolution-rollup") {
    const { rollupEvolutionFindings } = require("./core/maintenance");
    const parsed = args.threshold ? Number.parseInt(args.threshold, 10) : undefined;
    const rollup = rollupEvolutionFindings(targetRoot, Number.isInteger(parsed) ? parsed : undefined);
    return { result: { target: targetRoot, findings: rollup.findings, threshold: rollup.threshold, errors: [], warnings: [] } };
  }
  if (action === "regression-proposals") {
    const { extractRegressionProposals } = require("./core/maintenance");
    return { result: { target: targetRoot, proposals: extractRegressionProposals(targetRoot), errors: [], warnings: [] } };
  }
  if (action === "distill") {
    const { writeDistillProposal } = require("./distill-candidates");
    const outputPath = args.output || path.join(targetRoot, "docs", "maintenance", "distill-proposals.md");
    const proposal = writeDistillProposal(targetRoot, outputPath, args);
    return { result: { target: targetRoot, outputPath: proposal.outputPath, candidateCount: proposal.candidateCount, errors: [], warnings: [] } };
  }
  return { result: unknownAction("maintenance", ["inspect", "propose", "stale-docs", "wiki-lint", "pack-drift", "upgrade-preview", "evolution-rollup", "regression-proposals", "distill"]) };
}

function handleAdoption(args) {
  const action = args._?.[0];
  if (action === "report")           return { result: amberCore.generateAdoptionReport(args.target, args) };
  if (action === "list")             return { result: amberCore.listAdoptionReports(args) };
  if (action === "index")            return { result: amberCore.writeAdoptionReportsIndex(args) };
  if (action === "validate")         return { result: amberCore.validateAdoptionReports(args) };
  if (action === "compare")          return { result: amberCore.compareAdoptionReports(args) };
  if (action === "gate")             return { result: amberCore.gateAdoptionReport(args) };
  if (action === "status")           return { result: amberCore.statusAdoptionReports(args) };
  if (action === "bundle")           return { result: amberCore.bundleAdoptionArtifacts(args) };
  if (action === "next-actions")     return { result: amberCore.writeAdoptionNextActions(args) };
  if (action === "decision-record")  return { result: amberCore.writeAdoptionDecisionRecord(args) };
  if (action === "apply-plan")       return { result: amberCore.writeAdoptionApplyPlan(args) };
  if (action === "selected-files")   return { result: amberCore.writeAdoptionSelectedFiles(args) };
  return { result: unknownAction("adoption", ["report", "list", "index", "validate", "compare", "gate", "status", "bundle", "next-actions", "decision-record", "apply-plan", "selected-files"]) };
}

function handleRoute(args) {
  const action = args._?.[0];
  let routeResult;
  if (action === "list")      routeResult = routeCommands.listRoutes();
  else if (action === "inspect")   routeResult = routeCommands.inspectRoute(args._?.[1] || "");
  else if (action === "validate")  routeResult = routeCommands.validateRouteFile(args._?.[1] || args.file || "");
  else if (action === "test")      routeResult = routeCommands.testRoute(args._?.[1] || "");
  else routeResult = { text: "route requires list, inspect, validate, or test.", exitCode: 1 };

  const r = { target: args.target, text: routeResult.text, errors: routeResult.exitCode === 0 ? [] : [routeResult.text], warnings: [] };
  return { result: r, exitCode: routeResult.exitCode, bypassPrint: !args.json };
}

async function handleSession(args) {
  const action = args._?.[0];
  const targetRoot = resolveTarget(args);
  let sessionResult;

  if (action === "start") {
    let parsedBudget;
    if (args.budget) {
      parsedBudget = parseInt(args.budget, 10);
      if (isNaN(parsedBudget) || parsedBudget <= 0) {
        sessionResult = { text: "Error: --budget must be a positive integer", exitCode: 1 };
      }
    }
    if (!sessionResult) {
      sessionResult = await sessionCommands.startSession(targetRoot, {
        goal: args.goal || args._?.[1],
        route: args.route,
        budget: parsedBudget,
        worktree: args.worktree,
        mode: args.mode,
      });
    }
  } else if (action === "status") {
    sessionResult = sessionCommands.statusSession(targetRoot, { sessionId: args._?.[1] });
  } else if (action === "list") {
    sessionResult = sessionCommands.listSessions(targetRoot, {});
  } else if (action === "abort") {
    sessionResult = await sessionCommands.abortSession(targetRoot, { sessionId: args._?.[1] });
  } else if (action === "continue") {
    sessionResult = await sessionCommands.continueSession(targetRoot, { sessionId: args._?.[1] });
  } else if (action === "complete-check") {
    if (!args.session) {
      sessionResult = { text: "session complete-check requires --session <id>.", exitCode: 1 };
    } else {
      const { buildCompletionResult } = require("./completion-check");
      const completion = buildCompletionResult(targetRoot, args.session, args);
      sessionResult = { text: completion.text, exitCode: completion.errors.length > 0 ? 1 : 0 };
    }
  } else if (action === "verify") {
    if (!args.session) {
      sessionResult = { text: "session verify requires --session <id>.", exitCode: 1 };
    } else {
      sessionResult = await sessionCommands.verifySession(targetRoot, {
        sessionId: args.session,
        stage: args.stage,
        command: args.command,
        result: args.result,
      });
    }
  } else if (action === "approve") {
    if (!args.session) {
      sessionResult = { text: "session approve requires --session <id>.", exitCode: 1 };
    } else {
      sessionResult = await sessionCommands.approveSession(targetRoot, {
        sessionId: args.session,
        gate: args.gate || args._?.[1],
      });
    }
  } else {
    sessionResult = { text: "session requires start, status, list, abort, continue, complete-check, verify, or approve.", exitCode: 1 };
  }

  const r = {
    target: args.target,
    text: sessionResult.text,
    errors: sessionResult.exitCode === 0 ? [] : [sessionResult.text],
    warnings: [],
    ...(sessionResult.sessionId ? { sessionId: sessionResult.sessionId } : {}),
  };
  return { result: r, exitCode: sessionResult.exitCode, bypassPrint: !args.json };
}

function handleMigrate(args) {
  const action = args._?.[0];
  const targetRoot = resolveTarget(args);

  if (action === "state") {
    const stateResult = migrateState(targetRoot);
    return {
      result: {
        ...stateResult,
        target: targetRoot,
        errors: [...stateResult.errors, ...stateResult.failed.map((f) => `validation failed: ${f}`)],
      },
    };
  }
  if (action === "wiki") {
    return { result: { ...migrateWiki(targetRoot), target: targetRoot } };
  }

  // Default: migrate manifests
  const migrateResult = migrateManifests(targetRoot, { dryRun: args.dryRun });
  return {
    result: { target: args.target, text: migrateResult.message, errors: [], warnings: [] },
    exitCode: 0,
    bypassPrint: !args.json,
    onBypass: () => {
      console.log(migrateResult.message);
      if (migrateResult.logs?.length > 0) {
        for (const log of migrateResult.logs) console.log(`  ${log}`);
      }
    },
  };
}

function handleDaemon(args) {
  const action = args._?.[0];
  const { stopDaemon, getDaemonStatus } = require("./daemon");

  if (action === "status") {
    const status = getDaemonStatus(process.cwd());
    const text = status.running ? `Daemon running (PID: ${status.pid})` : "Daemon not running";
    return {
      result: { target: args.target, text, errors: [], warnings: [] },
      exitCode: status.running ? 0 : 1,
      bypassPrint: !args.json,
    };
  }
  if (action === "stop") {
    const stop = stopDaemon(process.cwd());
    return {
      result: { target: args.target, text: stop.success ? "Daemon stopped" : stop.error, errors: stop.success ? [] : [stop.error], warnings: [] },
      exitCode: stop.success ? 0 : 1,
      bypassPrint: !args.json,
    };
  }
  return {
    result: { target: args.target, text: "Usage: harness daemon <status|stop>", errors: ["Unknown daemon subcommand"], warnings: [] },
    exitCode: 1,
    bypassPrint: !args.json,
  };
}

function handleGovernance(args) {
  const action = args._?.[0];
  const { createGovernanceDocs, exportGovernanceEvidence, inspectGovernancePolicy, auditGovernance } = require("./governance-commands");

  if (action === "docs")     return { result: createGovernanceDocs(args.target) };
  if (action === "evidence") return { result: exportGovernanceEvidence(resolveTarget(args), { session: args.session, task: args.task, all: args.all, output: args.output, json: args.json }) };
  if (action === "policy")   return { result: inspectGovernancePolicy(args.target) };
  if (action === "audit")    return { result: auditGovernance(args.target, { output: args.output, since: args.since }) };
  return { result: unknownAction("governance", ["docs", "evidence", "policy", "audit"]) };
}

function handleExecution(args) {
  const action = args._?.[0];
  if (action === "validate-integration") {
    const { validateIntegration } = require("./core/execution-validator");
    return { result: { target: args.target, ...validateIntegration(args.contract || "", { explain: args.explain || false }) } };
  }
  if (action === "readiness") {
    const planPath = args.plan || "";
    if (!planPath) return { result: { target: args.target, errors: ["execution readiness requires --plan <path>."], warnings: [] } };

    const { checkExecutionReadiness } = require("./core/execution-validator");
    const { resolveTarget: resolve } = require("./core/fs-utils");
    const targetRoot = resolve(args.target);
    const resolvedPlan = path.resolve(targetRoot, planPath);
    const readiness = checkExecutionReadiness(targetRoot, resolvedPlan, { strict: args.strict || false });
    return {
      result: { target: args.target, plan: planPath, ready: readiness.ready, blockers: readiness.blockers, errors: readiness.blockers, warnings: readiness.warnings, strictMode: readiness.strictMode },
    };
  }
  return { result: unknownAction("execution", ["validate-integration", "readiness"]) };
}

function handleSecurity(args) {
  if (args._?.[0] !== "audit") return { result: { errors: ["security requires audit."], warnings: [] } };
  const { generateSecurityAuditReport } = require("./security-commands");
  return { result: generateSecurityAuditReport(args.target || ".", args) };
}

function handleFeature(args) {
  const action = args._?.[0];
  const targetRoot = resolveTarget(args);
  let featureResult;

  if (action === "add") {
    featureResult = featureCommands.addFeature(targetRoot, {
      id: args.id || args._?.[1],
      title: args.title || args._?.[2],
      priority: args.priority,
      area: args.area,
    });
  } else if (action === "list") {
    featureResult = featureCommands.listFeatures(targetRoot);
  } else if (action === "remove") {
    featureResult = featureCommands.removeFeature(targetRoot, {
      id: args.id || args._?.[1],
    });
  } else if (action === "verify") {
    featureResult = featureCommands.recordFeatureEvidence(targetRoot, {
      feature: args.feature || args._?.[1],
      command: args.command,
      result: args.result,
      notes: args.notes,
    });
  } else if (action === "evidence") {
    featureResult = featureCommands.listFeatureEvidence(targetRoot, {
      feature: args.feature || args._?.[1],
    });
  } else {
    featureResult = { errors: ["feature requires add, list, remove, verify, or evidence."], warnings: [] };
  }

  // Build text output from the result
  if (action === "list") {
    const features = featureResult.features || [];
    if (features.length === 0) {
      featureResult.text = "No features registered.";
    } else {
      featureResult.text = features
        .map(
          (f) =>
            `  ${f.id} [${f.status || "not_started"}] ${f.title}${f.priority ? ` (P${f.priority})` : ""}`,
        )
        .join("\n");
      featureResult.text = `Features:\n${featureResult.text}`;
    }
  } else if (action === "add") {
    if (featureResult.feature) {
      featureResult.text = `Feature added: ${featureResult.feature.id} — ${featureResult.feature.title}`;
    }
  } else if (action === "remove") {
    if (featureResult.removed) {
      featureResult.text = `Feature removed: ${featureResult.removed.id} — ${featureResult.removed.title}`;
    }
  } else if (action === "verify") {
    if (featureResult.entry) {
      featureResult.text = [
        `Evidence recorded for feature: ${featureResult.featureId}`,
        `  Command: ${featureResult.entry.command}`,
        `  Result: ${featureResult.entry.result}`,
        `  Date: ${featureResult.entry.date}`,
      ].join("\n");
    }
  } else if (action === "evidence") {
    const evidence = featureResult.evidence || [];
    if (evidence.length === 0) {
      featureResult.text = `No evidence recorded for feature: ${featureResult.featureId}`;
    } else {
      featureResult.text = evidence
        .map(
          (e, i) =>
            `  [${i + 1}] ${e.date} | ${e.command} → ${e.result}`,
        )
        .join("\n");
      featureResult.text = `Evidence for ${featureResult.featureId}:\n${featureResult.text}`;
    }
  }

  return {
    result: {
      target: args.target,
      text: featureResult.text || "",
      errors: featureResult.errors || [],
      warnings: featureResult.warnings || [],
    },
    exitCode: (featureResult.errors || []).length > 0 ? 1 : 0,
    bypassPrint: !args.json,
  };
}

function handleClean(args) {
  const { cleanAmber } = require("./clean-command");
  const cleanResult = cleanAmber(args.target, { dryRun: args.dryRun });
  const lines = [];
  if (cleanResult.dryRun) {
    lines.push("[DRY RUN] Would remove:");
  } else {
    lines.push("Removed:");
  }
  for (const item of cleanResult.removed) {
    lines.push(`  - ${item}`);
  }
  return {
    result: {
      target: args.target,
      text: lines.join("\n"),
      errors: cleanResult.errors,
      warnings: cleanResult.warnings,
    },
    bypassPrint: !args.json,
  };
}

// ── Command registry ────────────────────────────────────────────────────────

const HANDLERS = {
  init:        handleInit,
  audit:       handleAudit,
  wiki:        handleWiki,
  doctor:      handleDoctor,
  handoff:     handleHandoff,
  plan:        handlePlan,
  gate:        handleGate,
  review:      handleReview,
  accept:      handleAccept,
  pack:        handlePack,
  profile:     handleProfile,
  task:        handleTask,
  result:      handleResult,
  agent:       handleAgent,
  loop:        handleLoop,
  team:        handleTeam,
  maintenance: handleMaintenance,
  adoption:    handleAdoption,
  route:       handleRoute,
  session:     handleSession,
  migrate:     handleMigrate,
  daemon:      handleDaemon,
  governance:  handleGovernance,
  execution:   handleExecution,
  security:    handleSecurity,
  feature:     handleFeature,
  clean:       handleClean,
};

// ── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Dispatch a command to its registered handler.
 *
 * @param {string} command
 * @param {object} args  Parsed CLI arguments
 * @returns {{ result: object, exitCode?: number, bypassPrint?: boolean, onBypass?: () => void }}
 */
function dispatch(command, args) {
  const handler = HANDLERS[command];
  if (!handler) {
    return { result: { errors: [`No handler registered for command: ${command}`], warnings: [] }, exitCode: 1 };
  }
  return handler(args);
}

module.exports = { dispatch, HANDLERS };
