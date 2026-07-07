"use strict";

/**
 * Command dispatcher for the Amber CLI.
 *
 * Replaces the monolithic if/else-if chain in amber.js with a lookup-table
 * pattern. Each command maps to a handler function that receives parsed args
 * and returns `{ result, exitCode }`. The dispatcher standardises the output
 * envelope (`{ target, errors, warnings, ... }`) so the CLI run() function
 * becomes a thin parser → dispatch → print pipeline.
 *
 * Watch item (architecture review 2026-07-07): the envelope standardisation is
 * load-bearing and the thin handlers are deliberate — do not delete them. But
 * if this file grows past ~1000 lines, move each switch-based sub-command
 * family (team/loop/adoption/maintenance) into its own module owning its
 * envelope mapping.
 */

const path = require("node:path");

// ── Barrel imports ──────────────────────────────────────────────────────────
// Direct core imports (the amber-core facade was removed — ADR-0005, #4 PR2).
const { scaffoldHarness, scaffoldWiki } = require("./core/scaffold");
const { auditProject, validateHandoff } = require("./core/audit");
const { doctor } = require("./core/doctor");
const { scaffoldPlan, validatePlanGate, confirmPlanGate, reviewPlan, acceptPlan } = require("./core/planning");
const { validateWiki } = require("./core/validators");
const { exportOkfBundle } = require("./core/okf-export");
const { inspectWorkflowPack, inspectWorkflowPackReadiness } = require("./core/workflow-packs");
const { inspectProjectProfile } = require("./core/profiles");
const { prepareTaskExecution, inspectTaskResult } = require("./core/task-execution");
const { dispatchAgentTask, setAgentDispatchStatus, recordAgentReview } = require("./core/agent-orchestration");
const { inspectLoopContract, recommendLoopContract, recordLoopContract, inspectLoopLedger } = require("./core/loops");
const { executeLoopContract, approveLoopContract, verifyLoopLedger } = require("./core/loop-execution");
const { inspectTeamDistribution, installTeamDistribution, pinTeamDistribution, updateTeamDistribution, rollbackTeamDistribution } = require("./core/team");
const { inspectMaintenance, proposeMaintenance } = require("./core/maintenance");
const { generateAdoptionReport, listAdoptionReports, writeAdoptionReportsIndex, validateAdoptionReports, compareAdoptionReports } = require("./core/adoption-reports");
const { gateAdoptionReport, statusAdoptionReports } = require("./core/adoption-gate");
const { bundleAdoptionArtifacts, writeAdoptionNextActions } = require("./core/adoption-bundle");
const { writeAdoptionDecisionRecord, writeAdoptionApplyPlan, writeAdoptionSelectedFiles } = require("./core/adoption-proposals");
const routeCommands = require("./route-commands");
const sessionCommands = require("./session-commands");
const featureCommands = require("./feature-commands");
const { inferNext } = require("./next-command");
const { migrateManifests } = require("./migrate-command");
const { migrateState, migrateWiki } = require("./state-migration");
const { validateWorkflowPack, validateLoopContract } = require("./core/execution-validator");

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
    result: scaffoldHarness(args.target, {
      dryRun: args.dryRun,
      withWiki: args.withWiki,
      skipDetection: args.skipDetection,
      refreshAmberOwned: args.refreshAmberOwned,
    }),
  };
}

function handleAudit(args) {
  return { result: auditProject(args.target) };
}

function handleWiki(args) {
  const action = args._?.[0];
  if (action === "export") {
    return { result: exportOkfBundle(args.target, { outputDir: args.outputDir }) };
  }
  if (args.okf) {
    return { result: validateWiki(args.target, { okf: true }) };
  }
  return { result: scaffoldWiki(args.target, { dryRun: args.dryRun }) };
}

function handleDoctor(args) {
  return { result: doctor(args.target, { okf: args.okf }) };
}

function handleHandoff(args) {
  return { result: validateHandoff(args.target) };
}

function handlePlan(args) {
  return {
    result: scaffoldPlan(args.target, {
      feature: args.feature,
      title: args.title,
      dryRun: args.dryRun,
    }),
  };
}

function handleGate(args) {
  if (args.confirm) {
    return { result: confirmPlanGate(args.target, args.plan) };
  }
  return { result: validatePlanGate(args.target, args.plan) };
}

function handleReview(args) {
  return { result: reviewPlan(args.target, args.plan) };
}

function handleAccept(args) {
  const acceptResult = acceptPlan(args.target, args.plan);
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
    const r = inspectWorkflowPack(args.file || "");
    if (action === "validate") r.valid = r.errors.length === 0;
    return { result: r };
  }
  if (action === "readiness") {
    return { result: inspectWorkflowPackReadiness(args.file || args._?.[1] || "") };
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
  return { result: inspectProjectProfile(args.file || "") };
}

function handleTask(args) {
  if (args._?.[0] !== "prepare") {
    return { result: unknownAction("task", ["prepare"]) };
  }
  return { result: prepareTaskExecution(args.target, args.plan, args.task, args) };
}

function handleResult(args) {
  if (args._?.[0] !== "inspect") {
    return { result: unknownAction("result", ["inspect"]) };
  }
  return { result: inspectTaskResult(args.target, args.task) };
}

function handleAgent(args) {
  const action = args._?.[0];
  if (action === "dispatch") return { result: dispatchAgentTask(args.target, args) };
  if (action === "stop") return { result: setAgentDispatchStatus(args.target, args.task, "stopped") };
  if (action === "resume") return { result: setAgentDispatchStatus(args.target, args.task, "dispatched") };
  if (action === "review") return { result: recordAgentReview(args.target, args) };
  return { result: unknownAction("agent", ["dispatch", "stop", "resume", "review"]) };
}

function handleLoop(args) {
  const action = args._?.[0];
  if (action === "inspect") {
    return { result: inspectLoopContract({ file: args.file, contract: args.contract }) };
  }
  if (action === "recommend") {
    return { result: recommendLoopContract({ target: args.target, file: args.file, goal: args.goal }) };
  }
  if (action === "run") {
    return { result: executeLoopContract({ file: args.file, contract: args.contract, target: args.target, execute: args.execute, dryRun: args.dryRun, output: args.output }) };
  }
  if (action === "approve") {
    return { result: approveLoopContract({ file: args.file, contract: args.contract, target: args.target, reviewer: args.reviewer }) };
  }
  if (action === "verify-ledger") {
    return { result: verifyLoopLedger({ target: args.target, contract: args.contract }) };
  }
  if (action === "record") {
    return { result: recordLoopContract({ file: args.file, contract: args.contract, triggerSource: args.triggerSource, stopReason: args.stopReason, output: args.output }) };
  }
  if (action === "status") {
    return { result: inspectLoopLedger({ ledger: args.ledger }) };
  }
  if (action === "validate-loop") {
    return { result: validateLoopContract(args.contract) };
  }
  return { result: unknownAction("loop", ["inspect", "recommend", "run", "approve", "verify-ledger", "record", "status", "validate-loop"]) };
}

function handleTeam(args) {
  const action = args._?.[0];
  if (action === "inspect")  return { result: inspectTeamDistribution(args.target, args) };
  if (action === "install")  return { result: installTeamDistribution(args.target, args) };
  if (action === "pin")      return { result: pinTeamDistribution(args.target, args) };
  if (action === "update")   return { result: updateTeamDistribution(args.target, args) };
  if (action === "rollback") return { result: rollbackTeamDistribution(args.target, args) };
  return { result: unknownAction("team", ["inspect", "install", "pin", "update", "rollback"]) };
}

function handleMaintenance(args) {
  const action = args._?.[0];
  if (action === "inspect")  return { result: inspectMaintenance(args.target, args) };
  if (action === "propose" || action === "proposal") return { result: proposeMaintenance(args.target, args) };

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
  if (action === "scaffold-drift") {
    const { detectScaffoldDrift } = require("./core/scaffold-version-drift");
    const drift = detectScaffoldDrift(targetRoot);
    return { result: { target: targetRoot, scaffoldDrift: drift, errors: [], warnings: [] } };
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
  return { result: unknownAction("maintenance", ["inspect", "propose", "stale-docs", "scaffold-drift", "wiki-lint", "pack-drift", "upgrade-preview", "evolution-rollup", "regression-proposals", "distill"]) };
}

function handleAdoption(args) {
  const action = args._?.[0];
  if (action === "report")           return { result: generateAdoptionReport(args.target, args) };
  if (action === "list")             return { result: listAdoptionReports(args) };
  if (action === "index")            return { result: writeAdoptionReportsIndex(args) };
  if (action === "validate")         return { result: validateAdoptionReports(args) };
  if (action === "compare")          return { result: compareAdoptionReports(args) };
  if (action === "gate")             return { result: gateAdoptionReport(args) };
  if (action === "status")           return { result: statusAdoptionReports(args) };
  if (action === "bundle")           return { result: bundleAdoptionArtifacts(args) };
  if (action === "next-actions")     return { result: writeAdoptionNextActions(args) };
  if (action === "decision-record")  return { result: writeAdoptionDecisionRecord(args) };
  if (action === "apply-plan")       return { result: writeAdoptionApplyPlan(args) };
  if (action === "selected-files")   return { result: writeAdoptionSelectedFiles(args) };
  return { result: unknownAction("adoption", ["report", "list", "index", "validate", "compare", "gate", "status", "bundle", "next-actions", "decision-record", "apply-plan", "selected-files"]) };
}

function handleLedger(args) {
  const action = args._ && args._[0];
  const targetRoot = resolveTarget(args);
  if (action === "export") {
    const { exportLedger } = require("./core/ledger-export");
    const r = exportLedger(targetRoot, { format: args.format, home: args.home });
    if (args.out) {
      const fs = require("node:fs");
      const path = require("node:path");
      const outPath = path.resolve(targetRoot, args.out);
      fs.writeFileSync(outPath, r.payload + "\n");
      return { result: { target: args.target, text: `Wrote ${r.ledgers.length} ledger(s) to ${outPath} (intact=${r.intactCount}, broken=${r.brokenCount})`, errors: r.errors, warnings: r.warnings }, bypassPrint: !args.json };
    }
    if (args.json) return { result: { target: args.target, ...r, errors: r.errors, warnings: r.warnings } };
    return { result: { target: args.target, text: r.payload, errors: r.errors, warnings: r.warnings }, bypassPrint: true };
  }
  if (action === "seal") {
    const { sealLedger } = require("./core/ledger-seal");
    const r = sealLedger(targetRoot, { reviewer: args.reviewer });
    const text = r.sealed
      ? `Sealed ${r.ledgerCount} ledger(s) to tag ${r.tagName} at HEAD ${r.head}.`
      : `Seal failed: ${r.errors.join("; ")}`;
    return { result: { target: args.target, text, ...r, errors: r.errors, warnings: r.warnings }, exitCode: r.sealed ? 0 : 1, bypassPrint: !args.json };
  }
  if (action === "verify-anchoring") {
    const { verifyAnchoring } = require("./core/ledger-seal");
    const r = verifyAnchoring(targetRoot);
    const text = r.anchored
      ? `Anchored: all ledgers match seal tag ${r.sealTag}.`
      : `NOT anchored: ${r.ledgerChangedSinceSeal} ledger(s) changed since seal tag ${r.sealTag}.`;
    return { result: { target: args.target, text, ...r, errors: r.errors, warnings: r.warnings }, exitCode: r.anchored ? 0 : 1, bypassPrint: !args.json };
  }
  return { result: { target: args.target, errors: ["ledger requires export, seal, or verify-anchoring."], warnings: [] } };
}

function handleRoute(args) {
  const action = args._?.[0];
  const routeId = args._?.[1] || "";
  const targetRoot = resolveTarget(args);
  let routeResult;

  if (action === "list") routeResult = routeCommands.listRoutes();
  else if (action === "inspect") routeResult = routeCommands.inspectRoute(routeId);
  else if (action === "validate") routeResult = routeCommands.validateRouteFile(args.file || routeId);
  else if (action === "test") {
    // Governed execution of a single command stage (GLX Phase 3); default stays dry-run.
    if (args.execute && args.stage) {
      const er = routeCommands.executeRouteStage(routeId, args.stage, targetRoot);
      routeResult = { text: er.text, exitCode: er.exitCode };
    } else {
      routeResult = routeCommands.testRoute(routeId);
    }
  } else if (action === "approve") {
    if (!args.stage) {
      routeResult = { text: "route approve requires --stage <name>.", exitCode: 1 };
    } else {
      routeResult = routeCommands.approveRouteStage(routeId, args.stage, targetRoot, args.reviewer);
    }
  } else if (action === "verify-ledger") {
    routeResult = routeCommands.verifyRouteLedger(routeId, targetRoot);
  } else {
    routeResult = { text: "route requires list, inspect, validate, test, approve, or verify-ledger.", exitCode: 1 };
  }

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
    sessionResult = await sessionCommands.abortSession(targetRoot, { sessionId: args._?.[1] || args.session, requestId: args.requestId });
  } else if (action === "continue") {
    sessionResult = await sessionCommands.continueSession(targetRoot, { sessionId: args._?.[1] || args.session, requestId: args.requestId });
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
        execute: args.execute,
      });
    }
  } else if (action === "approve") {
    if (!args.session) {
      sessionResult = { text: "session approve requires --session <id>.", exitCode: 1 };
    } else {
      sessionResult = await sessionCommands.approveSession(targetRoot, {
        sessionId: args.session,
        gate: args.gate || args._?.[1],
        yes: args.yes,
      });
    }
  } else if (action === "verify-ledger") {
    if (!args.session) {
      sessionResult = { text: "session verify-ledger requires --session <id>.", exitCode: 1 };
    } else {
      sessionResult = sessionCommands.verifyLedgerSession(targetRoot, args.session);
    }
  } else {
    sessionResult = { text: "session requires start, status, list, abort, continue, complete-check, verify, verify-ledger, or approve.", exitCode: 1 };
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

function handleGovernance(args) {
  const action = args._?.[0];
  const {
    createGovernanceDocs,
    exportGovernanceEvidence,
    inspectGovernancePolicy,
    auditGovernance,
    inspectGovernanceReadinessCommand,
    mapStandardsCommand,
    governanceRulesCommand,
  } = require("./governance-commands");

  if (action === "docs")     return { result: createGovernanceDocs(args.target) };
  if (action === "evidence") return { result: exportGovernanceEvidence(resolveTarget(args), { session: args.session, task: args.task, all: args.all, output: args.output, json: args.json }) };
  if (action === "policy")   return { result: inspectGovernancePolicy(args.target) };
  if (action === "audit")    return { result: auditGovernance(args.target, { output: args.output, since: args.since }) };
  if (action === "readiness") return { result: inspectGovernanceReadinessCommand(args.target, { output: args.output }) };
  if (action === "standards") return { result: mapStandardsCommand(args.target, { framework: args.framework, json: args.json }) };
  if (action === "rules")    return { result: governanceRulesCommand(args._?.[1], args.target, { command: args.command, json: args.json }) };
  return { result: unknownAction("governance", ["docs", "evidence", "policy", "audit", "readiness", "standards", "rules"]) };
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
      paths: args.paths,
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

function handleNext(args) {
  const nextResult = inferNext(args.target, { feature: args.feature, session: args.session });
  return { result: nextResult, exitCode: 0, bypassPrint: !args.json };
}

function handleDrift(args) {
  const { runDrift, renderDrift } = require("./drift-command");
  const result = runDrift(args.target, {
    scope: args.scope,
    noFail: args.noFail,
  });
  if (args.json) {
    return { result: { target: args.target, ...result, errors: [], warnings: [] }, exitCode: result.exitCode, bypassPrint: false };
  }
  const text = args.format === "gh-annotations" ? renderDrift(result, { format: "gh-annotations" }) : renderDrift(result);
  return {
    result: { target: args.target, text, drift: result, errors: [], warnings: [] },
    exitCode: result.exitCode,
    bypassPrint: true,
  };
}

function handleStatus(args) {
  const statusCommand = require("./status-command");
  const targetRoot = resolveTarget(args);
  const status = statusCommand.buildStatus(targetRoot);
  return {
    result: {
      target: args.target,
      text: statusCommand.renderStatus(status),
      status,
      errors: [],
      warnings: [],
    },
    bypassPrint: !args.json,
  };
}

function handleSync(args) {
  const targetRoot = resolveTarget(args);
  const { detectScaffoldDrift, refreshAmberOwnedFiles } = require("./core/scaffold-version-drift");
  const { detectArtifactDrift } = require("./core/artifact-drift");
  // Forward a caller-supplied templateRoot (mirrors scaffoldHarness's option) so
  // the shipped-template source is the SAME one used at install time. Undefined
  // in the real CLI → both helpers fall back to the default TEMPLATE_ROOT.
  const opts = args.templateRoot ? { templateRoot: args.templateRoot } : {};
  const drift = detectScaffoldDrift(targetRoot, opts);
  const artifact = detectArtifactDrift(targetRoot);
  const note = artifact.available && artifact.counts.drifted > 0
    ? `Artifact drift: ${artifact.counts.drifted} drifted — re-verify with \`amber feature verify --feature <id>\`.`
    : "Artifact drift: none detected. (aligned = code not newer than evidence; not a re-verification)";
  let refresh = null;
  if (args.execute) refresh = refreshAmberOwnedFiles(targetRoot, opts);

  const lines = [`Target: ${targetRoot}`, `Mode: ${args.execute ? "execute" : "dry-run (no changes made)"}`];
  if (drift.installed) {
    const c = drift.counts;
    lines.push(`Scaffold drift: fresh=${c.fresh} stale=${c.stale} customized=${c.customized} ambiguous=${c.ambiguous} missing=${c.missing}`);
  } else {
    lines.push(`Scaffold drift: ${drift.note || "no provenance"}`);
  }
  if (refresh) {
    lines.push(`Refreshed (stale controlled): ${refresh.refreshed.length} — ${refresh.refreshed.join(", ") || "(none)"}`);
    lines.push(`Proposals cached (customized/ambiguous): ${refresh.proposals.length} — ${refresh.proposals.join(", ") || "(none)"}`);
  }
  lines.push(note);

  return {
    result: {
      target: args.target,
      text: lines.join("\n"),
      sync: { executed: Boolean(args.execute), drift, refresh, note },
      errors: [],
      warnings: [],
    },
    bypassPrint: !args.json,
  };
}

function handleExplain(args) {
  const { explain } = require("./explain-command");
  const r = explain(args);
  return {
    result: { target: args.target, text: r.text, errors: r.errors, warnings: r.warnings },
    exitCode: r.errors.length > 0 ? 1 : 0,
    bypassPrint: !args.json,
  };
}

function handleHooks(args) {
  const hooks = require("./hooks-command");
  const action = args._?.[0];
  let r;
  if (action === "check") r = hooks.checkGovernance(args.target, { warnOnly: args.warnOnly });
  else if (action === "install") r = hooks.installHook(args.target, { warnOnly: args.warnOnly, force: args.force });
  else if (action === "uninstall") r = hooks.uninstallHook(args.target);
  else if (action === "status") r = hooks.statusHook(args.target);
  else return { result: unknownAction("hooks", ["check", "install", "uninstall", "status"]) };

  return {
    result: { target: args.target, text: r.text || "", errors: r.errors || [], warnings: r.warnings || [] },
    exitCode: (r.errors || []).length > 0 ? 1 : 0,
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
  status:      handleStatus,
  drift:       handleDrift,
  sync:        handleSync,
  task:        handleTask,
  result:      handleResult,
  agent:       handleAgent,
  loop:        handleLoop,
  ledger:      handleLedger,
  team:        handleTeam,
  maintenance: handleMaintenance,
  adoption:    handleAdoption,
  route:       handleRoute,
  session:     handleSession,
  migrate:     handleMigrate,
  governance:  handleGovernance,
  execution:   handleExecution,
  security:    handleSecurity,
  feature:     handleFeature,
  clean:       handleClean,
  next:        handleNext,
  explain:     handleExplain,
  hooks:       handleHooks,
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
