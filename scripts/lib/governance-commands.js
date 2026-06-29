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
const { mapStandards } = require("./core/standards");

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
    lines.push(`  ${risk.id} ${risk.title}: ${risk.amberCoverage}${ctrl}`);
  }
  lines.push("", `Note: ${result.disclaimer}`);
  return { ...result, text: lines.join("\n") };
}

module.exports = {
  createGovernanceDocs,
  exportGovernanceEvidence,
  inspectGovernancePolicy,
  auditGovernance,
  inspectGovernanceReadinessCommand,
  mapStandardsCommand
};
