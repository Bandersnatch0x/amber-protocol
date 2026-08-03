"use strict";

/**
 * Switch-based command-family handlers extracted from command-dispatcher.js
 * so that file stays under its ~1000-line self-documented threshold (#63).
 * Each handler owns its arg → envelope mapping; the dispatcher only registers them.
 */

const {
  generateAdoptionReport,
  listAdoptionReports,
  writeAdoptionReportsIndex,
  validateAdoptionReports,
  compareAdoptionReports,
} = require("./core/adoption-reports");
const { gateAdoptionReport, statusAdoptionReports } = require("./core/adoption-gate");
const { bundleAdoptionArtifacts, writeAdoptionNextActions } = require("./core/adoption-bundle");
const {
  writeAdoptionDecisionRecord,
  writeAdoptionApplyPlan,
  writeAdoptionSelectedFiles,
} = require("./core/adoption-proposals");
const sessionCommands = require("./session-commands");

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

function handleMaintenance(args) {
  // F014-M3: the Maintenance command adapter owns all ten subcommands.
  const { maintenanceDispatch } = require("./maintenance/adapters/command");
  return maintenanceDispatch(args._?.[0], args);
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
    let text;
    if (r.errors && r.errors.length > 0) {
      // Surface the domain layer error first (e.g. "no seal tag found") instead
      // of printing "NOT anchored: undefined ledger(s) changed since seal tag undefined"
      text = r.errors.join("; ");
    } else if (r.anchored) {
      text = `Anchored: all ledgers match seal tag ${r.sealTag}.`;
    } else {
      text = `NOT anchored: ${r.ledgerChangedSinceSeal} ledger(s) changed since seal tag ${r.sealTag}.`;
    }
    return { result: { target: args.target, text, ...r, errors: r.errors, warnings: r.warnings }, exitCode: r.errors?.length ? 1 : r.anchored ? 0 : 1, bypassPrint: !args.json };
  }
  return { result: { target: args.target, errors: ["ledger requires export, seal, or verify-anchoring."], warnings: [] } };
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
        feature: args.feature,
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
  } else if (action === "complete") {
    if (!args.session) {
      sessionResult = { text: "session complete requires --session <id>.", exitCode: 1 };
    } else {
      sessionResult = await sessionCommands.completeSession(targetRoot, {
        sessionId: args.session,
        strict: args.strict,
        requestId: args.requestId,
      });
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
        feature: args.feature,
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
    sessionResult = { text: "session requires start, status, list, abort, continue, complete-check, complete, verify, verify-ledger, or approve.", exitCode: 1 };
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

function handleGovernance(args) {
  const action = args._?.[0];
  const { governanceDispatch } = require("./governance-commands");
  // Single chokepoint owns the 8-action switch, requireTarget guard, and
  // shared try/catch. Sub-actions (standards init, rules init/inspect/check)
  // travel as options.action from args._[1].
  return {
    result: governanceDispatch(action, args.target, {
      session: args.session,
      task: args.task,
      all: args.all,
      output: args.output,
      since: args.since,
      framework: args.framework,
      json: args.json,
      targetDisplay: args.target || ".",
      action: args._?.[1],
      command: args.command,
    }),
  };
}

module.exports = {
  handleMaintenance,
  handleAdoption,
  handleLedger,
  handleSession,
  handleGovernance,
  // test/helpers
  unknownAction,
  resolveTarget,
};
