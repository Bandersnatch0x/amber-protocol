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
 * Switch-based families (maintenance/adoption/ledger/session/governance) live in
 * command-handler-families.js (#63) so this file stays a thin registry + simple
 * wrappers. Envelope standardisation is load-bearing — do not delete thin handlers.
 */

const path = require("node:path");

// ── Barrel imports ──────────────────────────────────────────────────────────
// Direct core imports (the amber-core facade was removed — ADR-0005, #4 PR2).
const { scaffoldHarness, scaffoldWiki } = require("./core/scaffold");
const {
	scaffoldKnowledgePlan,
	loadKnowledgePlan,
	buildKnowledgeReport,
	formatKnowledgeReportText,
	materializeKnowledgeBase,
	proposeKnowledgePlan,
} = require("./core/knowledge-plan");
const { auditProject, validateHandoff } = require("./core/audit");
const { doctor } = require("./core/doctor");
const { scaffoldPlan, validatePlanGate, confirmPlanGate, reviewPlan, acceptPlan, readPlanField } = require("./core/planning");
const { validateWiki } = require("./core/validators");
const { exportOkfBundle } = require("./core/okf-export");
const { inspectWorkflowPack, inspectWorkflowPackReadiness } = require("./core/workflow-packs");
const { inspectProjectProfile } = require("./core/profiles");
const { prepareTaskExecution, inspectTaskResult } = require("./core/task-execution");
const { dispatchAgentTask, setAgentDispatchStatus, recordAgentReview } = require("./core/agent-orchestration");
const { inspectLoopContract, recommendLoopContract, recordLoopContract, inspectLoopLedger } = require("./core/loops");
const { executeLoopContract, approveLoopContract, verifyLoopLedger } = require("./core/loop-execution");
const { inspectTeamDistribution, installTeamDistribution, pinTeamDistribution, updateTeamDistribution, rollbackTeamDistribution } = require("./core/team");
const routeCommands = require("./route-commands");
const featureCommands = require("./feature-commands");
const {
  handleMaintenance,
  handleAdoption,
  handleLedger,
  handleSession,
  handleGovernance,
  unknownAction,
  resolveTarget,
} = require("./command-handler-families");
const { inferNext } = require("./next-command");
const { migrateManifests } = require("./migrate-command");
const { migrateState, migrateWiki } = require("./state-migration");
const { validateWorkflowPack, validateLoopContract } = require("./core/execution-validator");

// ── Helpers ─────────────────────────────────────────────────────────────────
// unknownAction + resolveTarget are imported from command-handler-families.js
// (above) so the two handler files share one copy and cannot diverge.

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

  // Knowledge Plan support (declarative architecture + knowledge cards, integrated for Amber)
  if (action === "knowledge") {
    const sub = args._?.[1]; // e.g. scaffold | inspect | report
    const dryRun = Boolean(args.dryRun);

    if (sub === "scaffold" || !sub) {
      // default "amber wiki knowledge" scaffolds the plan (idempotent)
      const res = scaffoldKnowledgePlan(args.target, { dryRun, yaml: args.yaml || args.yml });
      return { result: res };
    }

    if (sub === "inspect") {
      const loaded = loadKnowledgePlan(args.target);
      return { result: loaded, bypassPrint: !args.json, onBypass: () => {
        if (loaded.found && loaded.plan) {
          console.log(JSON.stringify(loaded.plan, null, 2));
        } else {
          console.log(loaded.errors?.length ? loaded.errors.join("\n") : "No knowledge-plan.json found.");
        }
      }};
    }

    if (sub === "report") {
      const report = buildKnowledgeReport(args.target);
      return {
        result: report,
        bypassPrint: !args.json,
        onBypass: () => {
          console.log(formatKnowledgeReportText(report));
        },
      };
    }

    if (sub === "validate") {
      const loaded = loadKnowledgePlan(args.target);
      const result = {
        target: loaded.target,
        found: loaded.found,
        valid: loaded.errors.length === 0,
        errors: loaded.errors,
        warnings: loaded.warnings,
      };
      return { result };
    }

    if (sub === "build" || sub === "materialize") {
      const res = materializeKnowledgeBase(args.target, { dryRun: args.dryRun });
      return { result: res };
    }

    if (sub === "plan") {
      const res = proposeKnowledgePlan(args.target, { dryRun: args.dryRun, force: args.force });
      return {
        result: res,
        bypassPrint: !args.json,
        onBypass: () => {
          console.log(`Knowledge Plan proposal for ${res.target}`);
          console.log(`Inspection: ${res.inspectionSummary}`);
          if (res.created.length) console.log(`Wrote: ${res.created.join(", ")}`);
          if (res.skipped.length) console.log(`Skipped (existing): ${res.skipped.join(", ")}`);
          if (args.json) {
            console.log(JSON.stringify(res.suggestedPlan, null, 2));
          }
        },
      };
    }

    return { result: { target: args.target, errors: [`Unknown knowledge action: ${sub || ""}. Supported: plan, scaffold, inspect, report, validate, build.`], warnings: [] } };
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
  const action = args._?.[0];
  if (action === "bundle") {
    const { writeHandoffBundle } = require("./core/handoff-bundle");
    return { result: writeHandoffBundle(resolveTarget(args), { outputDir: args.outputDir || args.bundleDir, targetDisplay: args.target || "." }) };
  }
  if (action === "validate") {
    const { defaultBundleDir, resolveTargetRelativePath, validateHandoffBundle } = require("./core/handoff-bundle");
    const targetRoot = resolveTarget(args);
    const bundleDir = args.bundleDir || args.outputDir
      ? resolveTargetRelativePath(targetRoot, args.bundleDir || args.outputDir)
      : defaultBundleDir(targetRoot);
    return { result: { target: targetRoot, ...validateHandoffBundle(bundleDir) } };
  }
  const { writeHandoff } = require("./handoff-command");
  const rel = "session-handoff.md";
  const written = writeHandoff(args.target, { dryRun: args.dryRun });
  const validation = validateHandoff(args.target);
  const wrote = written.changed && !args.dryRun;
  return {
    result: {
      target: validation.target,
      created: wrote ? [rel] : [],
      skipped: written.changed ? [] : [rel],
      nextSteps: validation.nextSteps || [],
      warnings: [
        ...(validation.warnings || []),
        ...(args.dryRun && written.changed
          ? [`Dry-run: ${rel} would be regenerated from live state (not written).`]
          : []),
      ],
      errors: validation.errors || [],
    },
  };
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

// A plan belongs to the feature named in its `Feature:` header, and a session
// has a feature too. When accept is run with a session, the two must agree —
// otherwise accepting would mark/append the WRONG feature (e.g. accept F001's
// plan while completing an F002 session). These read-only helpers surface both
// so handleAccept can validate before acceptPlan mutates feature_list.json.
function resolveSessionFeature(targetRoot, sessionId) {
  try {
    const { resolveStateDirForRead } = require("./state-dir-resolver");
    const { readSessionManifest } = require("./session-manifest");
    const stateDir = resolveStateDirForRead(targetRoot, { quiet: true });
    const loaded = readSessionManifest(path.join(stateDir, "sessions", sessionId));
    if (!loaded || loaded.corrupt || !loaded.manifest) return null;
    return loaded.manifest.feature || null;
  } catch {
    return null;
  }
}

function readPlanFeature(targetRoot, planRelPath) {
  if (!planRelPath) return null;
  try {
    const fs = require("node:fs");
    const abs = path.resolve(targetRoot, planRelPath);
    if (!fs.existsSync(abs)) return null;
    return readPlanField(fs.readFileSync(abs, "utf8"), "Feature") || null;
  } catch {
    return null;
  }
}

function handleAccept(args) {
  // Guard: when a session is named, the plan must belong to that session's
  // feature. Only block on a definite mismatch (both known and different) —
  // an unreadable session/plan falls through and is reported downstream.
  if (args.session) {
    const targetRoot = resolveTarget(args);
    const sessionFeature = resolveSessionFeature(targetRoot, args.session);
    const planFeature = readPlanFeature(targetRoot, args.plan);
    if (sessionFeature && planFeature && sessionFeature !== planFeature) {
      return {
        result: {
          target: args.target,
          accepted: false,
          errors: [
            `Plan feature ${planFeature} does not match session ${args.session} (feature ${sessionFeature}). ` +
              `Accept the plan for ${sessionFeature}, or pass a --session whose feature is ${planFeature}.`,
          ],
          warnings: [],
        },
      };
    }
  }

  const acceptResult = acceptPlan(args.target, args.plan, { force: args.force });
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

function handleWorkflow(args) {
  const action = args._?.[0];
  const { workflowDispatch } = require("./workflow-assessment/adapters/command");
  const targetRoot = resolveTarget(args);
  const result = workflowDispatch(action, targetRoot, {
    ...args,
    target: targetRoot,
  });
  // Only assess supports --output-dir (writes report to disk). findings/plan/
  // compare reject it; everything else emits raw JSON/Markdown to stdout
  // (parser-safe) with diagnostics on stderr. bypassPrint avoids the "Target:" envelope.
  const SUPPORTS_OUTPUT_DIR = action === "assess";
  if (args.outputDir && !SUPPORTS_OUTPUT_DIR) {
    // Reject --output-dir for non-assess actions. Diagnostics go to stderr and
    // stdout stays empty (parser-safe). onBypass prints the error itself
    // because the bypass+onBypass path skips the dispatcher's error printing.
    const msg = `'amber workflow ${action}' does not support --output-dir (only assess writes a report file).`;
    return {
      result: { target: targetRoot, errors: [msg], warnings: [] },
      bypassPrint: true,
      onBypass: () => { console.error(`ERROR: ${msg}`); },
      exitCode: 1,
    };
  }
  if (args.outputDir && action === "assess") {
    // Report written to disk; print only a one-line confirmation, not the body.
    for (const e of result.errors || []) console.error(`ERROR: ${e}`);
    return {
      result,
      bypassPrint: true,
      onBypass: () => { if (result.outputPath) console.log(`Wrote ${result.outputPath}`); },
      exitCode: (result.errors || []).length > 0 ? 1 : 0,
    };
  }
  if (action === "assess" || action === "findings" || action === "compare" || action === "plan") {
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    let text = "";
    // On hard errors for findings/plan/compare, leave stdout empty so a bare
    // `{}` is not mistaken for a valid empty result. assess still renders the
    // report body when present (schema-valid even with findings).
    if (errors.length === 0 || action === "assess") {
      if (action === "assess" && result.report) {
        const { renderJson, renderMarkdown } = require("./workflow-assessment/adapters/renderers");
        text = args.format === "markdown" ? renderMarkdown(result.report) : renderJson(result.report);
      } else if (action === "plan") {
        text = JSON.stringify({ findingId: result.findingId, draft: result.draft, dryRun: true, notice: result.notice }, null, 2);
      } else if (action === "findings" || action === "compare") {
        // findings/compare: emit the result envelope as JSON minus non-data keys
        const out = action === "findings"
          ? { findings: result.findings, count: result.count }
          : { dimensionDeltas: result.dimensionDeltas, findingsAdded: result.findingsAdded, findingsResolved: result.findingsResolved, suspiciousImprovements: result.suspiciousImprovements, schemaVersionBaseline: result.schemaVersionBaseline, schemaVersionCurrent: result.schemaVersionCurrent, versionMismatch: result.versionMismatch, coverageBaseline: result.coverageBaseline, coverageCurrent: result.coverageCurrent };
        text = JSON.stringify(out, null, 2);
      }
    }
    for (const w of warnings) console.error(`WARNING: ${w}`);
    for (const e of errors) console.error(`ERROR: ${e}`);
    // onBypass prints body only so amber.js does not re-emit warnings/errors
    // onto stdout (diagnostics already went to stderr; stdout stays parser-safe).
    return {
      result: { ...result, text },
      bypassPrint: true,
      onBypass: () => { if (text) console.log(text); },
      exitCode: errors.length > 0 ? 1 : 0,
    };
  }
  return { result };
}

function handleMigrate(args) {
  const action = args._?.[0];
  const targetRoot = resolveTarget(args);

  if (action === "state") {
    const stateResult = migrateState(targetRoot, { archiveLegacy: args.archiveLegacy });
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
  const featureResult = featureCommands.runFeatureAction(action, targetRoot, args);

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
  // strict defaults true inside lifecycle.buildContext so next matches
  // complete-check --strict / session complete (last-mile terminal steps).
  const nextResult = inferNext(args.target, {
    feature: args.feature,
    session: args.session,
    strict: args.strict !== false,
  });
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
  // Orchestration (scaffold + artifact drift + conditional refresh + note) lives
  // in core/sync-project. Handler keeps the lines[] text builder and result.sync
  // envelope byte-identical — artifact is intentionally NOT in result.sync.
  const { syncProject } = require("./core/sync-project");
  const { drift, refresh, note } = syncProject(targetRoot, {
    execute: Boolean(args.execute),
    templateRoot: args.templateRoot,
  });

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
  workflow:    handleWorkflow,
};

// ── Deprecated commands ─────────────────────────────────────────────────────
// These commands are isolated from the core governance flow and will be removed
// in v2. Users should migrate to equivalent governance commands.
const DEPRECATED_COMMANDS = new Set([
  "profile",
  "task",
  "result",
  "agent",
  "team",
  "adoption",
]);

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
  const response = handler(args);
  if (DEPRECATED_COMMANDS.has(command)) {
    const msg =
      `⚠️  DEPRECATED: 'amber ${command}' will be removed in a future version. ` +
      "Use 'amber governance' or 'amber maintenance' for equivalent functionality.";
    response.result.warnings = [...(response.result.warnings || []), msg];
  }
  return response;
}

module.exports = { dispatch, HANDLERS };
