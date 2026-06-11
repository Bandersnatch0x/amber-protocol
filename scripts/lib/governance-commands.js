"use strict";

const {
  governanceDocs,
  exportSessionEvidence,
  exportExecutionEvidence,
  inspectPolicy,
  generateAuditReport
} = require("./core/governance");

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

  if (!options.output) {
    return {
      target,
      errors: ["--output is required"],
      warnings: [],
    };
  }

  try {
    let result;
    if (options.session) {
      result = exportSessionEvidence(options.session, target, options.output);
    } else if (options.task) {
      result = exportExecutionEvidence(options.task, target, options.output);
    } else {
      return {
        target,
        errors: ["Must specify --session <id> or --task <id>"],
        warnings: [],
      };
    }

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

module.exports = {
  createGovernanceDocs,
  exportGovernanceEvidence,
  inspectGovernancePolicy,
  auditGovernance
};
