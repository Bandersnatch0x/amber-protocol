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
  evaluateCommandPolicy,
} = require("./core/loop-policy");

function createGovernanceDocs(target) {
  if (!target) {
    return {
      target,
      errors: ["--target is required"],
      warnings: [],
      created: [],
      skipped: [],
    };
  }

  try {
    const result = governanceDocs(target);
    return {
      target,
      created: result.created,
      skipped: result.skipped,
      errors: [],
      warnings: [],
    };
  } catch (error) {
    return {
      target,
      created: [],
      skipped: [],
      errors: [error.message],
      warnings: [],
    };
  }
}

function exportGovernanceEvidence(target, options = {}) {
  if (!target) {
    return {
      target,
      errors: ["--target is required"],
      warnings: [],
    };
  }

  if (!options.output && !options.all) {
    return {
      target,
      errors: ["--output is required (unless using --all)"],
      warnings: [],
    };
  }

  try {
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
  } catch (error) {
    return {
      target,
      errors: [error.message],
      warnings: [],
    };
  }
}

function inspectGovernancePolicy(target) {
  if (!target) {
    return {
      target,
      errors: ["--target is required"],
      warnings: [],
    };
  }

  try {
    const result = inspectPolicy(target);
    return {
      target,
      ...result,
    };
  } catch (error) {
    return {
      target,
      errors: [error.message],
      warnings: [],
    };
  }
}

function auditGovernance(target, options = {}) {
  if (!target) {
    return {
      target,
      errors: ["--target is required"],
      warnings: [],
    };
  }

  if (!options.output) {
    return {
      target,
      errors: ["--output is required"],
      warnings: [],
    };
  }

  try {
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
  } catch (error) {
    return {
      target,
      errors: [error.message],
      warnings: [],
    };
  }
}

function inspectGovernanceReadinessCommand(target, options = {}) {
  if (!target) {
    return {
      target,
      errors: ["--target is required"],
      warnings: [],
    };
  }

  try {
    const result = inspectGovernanceReadiness(target);
    const outputPath = options.output
      ? writeReadinessMarkdown(result, options.output)
      : undefined;

    return {
      ...result,
      outputPath,
      text: renderReadinessText(result),
    };
  } catch (error) {
    return {
      target,
      errors: [error.message],
      warnings: [],
    };
  }
}

function generateGovernanceReportCommand(target, options = {}) {
  if (!target) {
    return {
      target,
      errors: ["--target is required"],
      warnings: [],
    };
  }

  try {
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
  } catch (error) {
    return {
      target,
      errors: [error.message],
      warnings: [],
    };
  }
}

function mapStandardsCommand(target, options = {}) {
  if (!target) {
    return { target, errors: ["--target is required"], warnings: [] };
  }
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
function standardsInitCommand(target) {
  if (!target) {
    return { target, errors: ["--target is required"], warnings: [] };
  }
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
// runs a sample command through evaluateCommandPolicy (read-only, no execution).
function governanceRulesCommand(action, target, options = {}) {
  if (!target) {
    return { target, errors: ["--target is required"], warnings: [] };
  }
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
    const verdict = evaluateCommandPolicy(options.command, rules);
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

module.exports = {
  createGovernanceDocs,
  exportGovernanceEvidence,
  inspectGovernancePolicy,
  auditGovernance,
  inspectGovernanceReadinessCommand,
  generateGovernanceReportCommand,
  mapStandardsCommand,
  standardsInitCommand,
  governanceRulesCommand
};
