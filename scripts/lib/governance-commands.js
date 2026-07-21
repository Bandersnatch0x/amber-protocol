"use strict";

const fs = require("fs");
const path = require("path");
const {
  governanceDocs,
  exportSessionEvidence,
  exportExecutionEvidence,
  inspectPolicy,
  generateAuditReport
} = require("./core/governance");
const {
  inspectGovernanceReadiness,
  renderReadinessText,
  writeReadinessMarkdown
} = require("./core/governance-readiness");
const {
  buildGovernanceReport,
  renderGovernanceReportText,
  writeGovernanceReportMarkdown,
} = require("./core/governance-report");
const { mapStandards } = require("./core/standards");
const {
  DEFAULT_RULES,
  loadPolicyRules,
  evaluateGovernedPolicy,
} = require("./core/loop-policy");

const GOVERNANCE_ACTIONS = [
  "docs",
  "evidence",
  "policy",
  "audit",
  "readiness",
  "report",
  "standards",
  "rules",
];

// Shared --target guard. Every governance subcommand refuses without a target;
// consolidating the message + envelope shape here means a wording or shape
// change lands in one place, not nine. Returns null when the target is present
// so the caller falls through to its real body. `extra` spreads extra empty
// fields a caller promises in its success shape (e.g. created/skipped) so the
// error envelope still type-matches.
function requireTarget(target, extra = {}) {
  if (!target) {
    return { target, errors: ["--target is required"], warnings: [], ...extra };
  }
  return null;
}

// Shared requireTarget + try/catch envelope for every governance action.
// Pure success-path extras (created/skipped on docs) are only on the guard
// miss; catch always returns the minimal {target, errors, warnings} shape.
function runGuarded(target, extra, fn) {
  if (typeof extra === "function") {
    fn = extra;
    extra = {};
  }
  const badTarget = requireTarget(target, extra);
  if (badTarget) return badTarget;
  try {
    return fn();
  } catch (error) {
    return {
      target,
      errors: [error.message],
      warnings: [],
    };
  }
}

function unknownGovernanceAction() {
  const actions = GOVERNANCE_ACTIONS.slice();
  const last = actions.pop();
  return {
    target: undefined,
    errors: [`governance requires ${actions.join(", ")}, or ${last}.`],
    warnings: [],
  };
}

// --- Substantive action bodies (no requireTarget / try-catch; dispatch owns those) ---

function exportGovernanceEvidenceBody(target, options = {}) {
  if (!options.output && !options.all) {
    return {
      target,
      errors: ["--output is required (unless using --all)"],
      warnings: [],
    };
  }

  let result;
  if (options.all) {
    // Batch export all sessions and executions
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchDir = path.join(target, '.amber', 'governance', 'evidence', timestamp);
    fs.mkdirSync(batchDir, { recursive: true });

    const { resolveStateDirForRead } = require('./state-dir-resolver');
    const stateDir = resolveStateDirForRead(target);
    const sessionsDir = path.join(stateDir, 'sessions');
    const executionsDir = path.join(stateDir, 'executions');

    let exported = 0;
    const errors = [];

    // Export all sessions
    if (fs.existsSync(sessionsDir)) {
      const sessions = fs.readdirSync(sessionsDir);
      for (const sessionId of sessions) {
        try {
          const outputPath = path.join(batchDir, `session-${sessionId}.md`);
          exportSessionEvidence(sessionId, target, outputPath);
          exported++;
        } catch (err) {
          errors.push(`Session ${sessionId}: ${err.message}`);
        }
      }
    }

    // Export all executions
    if (fs.existsSync(executionsDir)) {
      const tasks = fs.readdirSync(executionsDir);
      for (const taskId of tasks) {
        try {
          const outputPath = path.join(batchDir, `execution-${taskId}.md`);
          exportExecutionEvidence(taskId, target, outputPath);
          exported++;
        } catch (err) {
          errors.push(`Execution ${taskId}: ${err.message}`);
        }
      }
    }

    result = { batchDir, count: exported, errors };
  } else if (options.session) {
    result = exportSessionEvidence(options.session, target, options.output);
  } else if (options.task) {
    result = exportExecutionEvidence(options.task, target, options.output);
  } else {
    return {
      target,
      errors: ["Must specify --session <id>, --task <id>, or --all"],
      warnings: [],
    };
  }

  return {
    target,
    ...result,
    errors: result.errors || [],
    warnings: [],
  };
}

function auditGovernanceBody(target, options = {}) {
  if (!options.output) {
    return {
      target,
      errors: ["--output is required"],
      warnings: [],
    };
  }

  const auditOptions = {};
  if (options.since) {
    auditOptions.since = options.since;
  }

  const result = generateAuditReport(target, options.output, auditOptions);

  return {
    target,
    ...result,
    errors: [],
    warnings: [],
  };
}

function inspectGovernanceReadinessBody(target, options = {}) {
  const result = inspectGovernanceReadiness(target);
  const outputPath = options.output
    ? writeReadinessMarkdown(result, options.output)
    : undefined;

  return {
    ...result,
    outputPath,
    text: renderReadinessText(result),
  };
}

function generateGovernanceReportBody(target, options = {}) {
  const report = buildGovernanceReport(target, { targetDisplay: options.targetDisplay || target });
  const output = options.output && !path.isAbsolute(options.output)
    ? path.resolve(target, options.output)
    : options.output;
  const outputPath = options.output
    ? writeGovernanceReportMarkdown(report, output)
    : undefined;

  return {
    ...report,
    outputPath,
    text: renderGovernanceReportText(report),
  };
}

function mapStandardsBody(target, options = {}) {
  const result = mapStandards(target, options.framework || "owasp-agentic");
  if (result.errors && result.errors.length) {
    return result;
  }
  const lines = [
    `Standards coverage: ${result.framework}`,
    `governance ${result.summary.governance} / partial ${result.summary.partial} / out-of-scope ${result.summary.outOfScope}`,
    "",
  ];
  for (const risk of result.risks) {
    const ctrl =
      risk.amberControls && risk.amberControls.length
        ? ` — ${risk.amberControls.join("; ")}`
        : "";
    const status = risk.present ? " [PRESENT]" : " [absent]";
    lines.push(`  ${risk.id} ${risk.title}: ${risk.amberCoverage}${status}${ctrl}`);
  }
  lines.push("", `Note: ${result.disclaimer}`);
  return { ...result, text: lines.join("\n") };
}

// Scaffold standards/security-governance.json — the declarative security-governance
// standard that inspectSecurityGovernance looks for. Idempotent (leaves an existing
// file untouched). Mirrors `governance rules init`. NOTE: the repo's own standards/
// dir is NOT shipped in the npm package (see package.json files), so the starter is
// served from templates/standards/ instead — init never reads Amber's own standards/.
function standardsInitBody(target) {
  const targetRoot = path.resolve(target);
  const standardsDir = path.join(targetRoot, "standards");
  const standardPath = path.join(standardsDir, "security-governance.json");
  if (fs.existsSync(standardPath)) {
    return {
      target,
      skipped: true,
      text: `standards/security-governance.json already exists: ${path.relative(targetRoot, standardPath)} (left untouched).`,
      errors: [],
      warnings: [],
    };
  }
  const templatePath = path.join(__dirname, "..", "..", "templates", "standards", "security-governance.json");
  if (!fs.existsSync(templatePath)) {
    return { target, errors: [`Security-standard template missing: ${templatePath}`], warnings: [] };
  }
  const content = fs.readFileSync(templatePath, "utf8");
  fs.mkdirSync(standardsDir, { recursive: true });
  fs.writeFileSync(standardPath, content);
  return {
    target,
    skipped: false,
    text: `Wrote standards/security-governance.json: declarative security-governance standard (6 review categories). Re-run \`amber governance standards\` to map coverage.`,
    errors: [],
    warnings: [],
  };
}

// GLX policy surface (B): scaffold and inspect the declarative command policy.
// init writes DEFAULT_RULES idempotently; inspect shows the active rules; check
// runs a sample command through evaluateGovernedPolicy (read-only, no execution)
// so the dry-run answer matches governed-runner (built-in deny-destructive +
// shell-composition), not the lower-level evaluateCommandPolicy layer alone.
function governanceRulesBody(action, target, options = {}) {
  const { resolveStateDirForRead, resolveStateDirForCreate } = require("./state-dir-resolver");

  if (action === "init") {
    const governanceDir = path.join(resolveStateDirForCreate(target), "governance");
    const rulesPath = path.join(governanceDir, "rules.json");
    if (fs.existsSync(rulesPath)) {
      return {
        target,
        skipped: true,
        text: `rules.json already exists: ${path.relative(target, rulesPath)} (left untouched).`,
        errors: [],
        warnings: [],
      };
    }
    fs.mkdirSync(governanceDir, { recursive: true });
    fs.writeFileSync(rulesPath, JSON.stringify(DEFAULT_RULES, null, 2) + "\n");
    return {
      target,
      skipped: false,
      text: `Wrote safe-default rules.json: ${path.relative(target, rulesPath)} (defaultAction=deny, ${DEFAULT_RULES.rules.length} rules).`,
      errors: [],
      warnings: [],
    };
  }

  if (action === "inspect") {
    const stateDir = resolveStateDirForRead(target);
    const rulesPath = path.join(stateDir, "governance", "rules.json");
    const fromDefaults = !fs.existsSync(rulesPath);
    const rules = fromDefaults ? DEFAULT_RULES : loadPolicyRules(target);
    const lines = [
      `Policy source: ${fromDefaults ? "defaults (no rules.json)" : path.relative(target, rulesPath)}`,
      `defaultAction: ${rules.defaultAction}`,
      `rules: ${rules.rules.length}`,
      "",
    ];
    for (const rule of rules.rules) {
      lines.push(`  [${rule.action}] ${rule.id} (${rule.match}: ${rule.pattern})`);
    }
    return {
      target,
      source: fromDefaults ? "defaults" : "rules.json",
      defaultAction: rules.defaultAction,
      ruleCount: rules.rules.length,
      text: lines.join("\n"),
      errors: [],
      warnings: [],
    };
  }

  if (action === "check") {
    if (!options.command) {
      return { target, errors: ["rules check requires --command <string>"], warnings: [] };
    }
    const rules = loadPolicyRules(target);
    // Same surface as governed-runner: un-removable built-ins first, then rules.
    const verdict = evaluateGovernedPolicy(options.command, rules);
    return {
      target,
      command: options.command,
      allowed: verdict.allowed,
      matchedRule: verdict.matchedRule,
      reason: verdict.reason,
      text: `${verdict.allowed ? "ALLOW" : "DENY"}: ${verdict.reason}`,
      errors: [],
      warnings: [],
    };
  }

  return { target, errors: [`governance rules requires init, inspect, or check.`], warnings: [] };
}

/**
 * Single governance-dispatch chokepoint. Owns the switch over all 8 actions,
 * the shared requireTarget guard, and the shared try/catch (runGuarded).
 *
 * Pure forwards (docs, policy, and the standards map path) are inlined as
 * branches. Substantive bodies are internal helpers called from branches.
 *
 * @param {string} action
 * @param {string} target
 * @param {object} [options]
 */
function governanceDispatch(action, target, options = {}) {
  switch (action) {
    case "docs":
      // Pure forward of governanceDocs — success extras preserved.
      return runGuarded(target, { created: [], skipped: [] }, () => {
        const result = governanceDocs(target);
        return {
          target,
          created: result.created,
          skipped: result.skipped,
          errors: [],
          warnings: [],
        };
      });

    case "evidence":
      return runGuarded(target, () => exportGovernanceEvidenceBody(target, options));

    case "policy":
      // Pure forward of inspectPolicy.
      return runGuarded(target, () => {
        const result = inspectPolicy(target);
        return {
          target,
          ...result,
        };
      });

    case "audit":
      return runGuarded(target, () => auditGovernanceBody(target, options));

    case "readiness":
      return runGuarded(target, () => inspectGovernanceReadinessBody(target, options));

    case "report":
      return runGuarded(target, () => generateGovernanceReportBody(target, options));

    case "standards":
      // init sub-action stays a substantive helper; map path is the pure forward.
      return runGuarded(target, () => {
        if (options.action === "init") {
          return standardsInitBody(target);
        }
        return mapStandardsBody(target, options);
      });

    case "rules":
      return runGuarded(target, () =>
        governanceRulesBody(options.action, target, options),
      );

    default:
      return unknownGovernanceAction();
  }
}

// Compatibility wrappers for tests that still import named entry points.
// These go through the dispatch chokepoint so guard/catch stay shared.
function exportGovernanceEvidence(target, options = {}) {
  return governanceDispatch("evidence", target, options);
}

function standardsInitCommand(target) {
  return governanceDispatch("standards", target, { action: "init" });
}

module.exports = {
  governanceDispatch,
  // Kept for existing tests that call the raw entry points.
  exportGovernanceEvidence,
  standardsInitCommand,
};
