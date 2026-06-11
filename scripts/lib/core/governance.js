const path = require('path');
const fs = require('fs');
const { readTimeline } = require('../timeline-reader');
const { loadPolicy } = require('../autonomous-policy');

function getDefaultPolicy() {
  return {
    gates: {
      auto: "approve",
      "user-approval": "block",
      "step-confirm": "block",
    },
    retry: {
      maxAttempts: 3,
      backoffMs: [1000, 5000, 15000],
      retryableStages: ["implement", "verify"],
    },
    budget: { onExceed: "pause" },
    notifications: { email: { enabled: false }, slack: { enabled: false } },
  };
}

function governanceDocs(targetRoot, options = {}) {
  const target = path.resolve(targetRoot);
  const govDir = path.join(target, '.amber', 'governance');

  fs.mkdirSync(govDir, { recursive: true });

  const templates = [
    { name: 'POLICY.md', content: `# Agent Policy

## Approval Gates

\`\`\`json
{
  "gates": {
    "auto": "approve",
    "user-approval": "block",
    "step-confirm": "block"
  }
}
\`\`\`

## Retry Budget

- Max attempts: 3
- Backoff: 1s, 5s, 15s
- Retryable stages: implement, verify

## Notification Channels

- Email: disabled
- Slack: disabled
` },
    { name: 'BOUNDARIES.md', content: `# Execution Boundaries

## Non-Goals

- No live multi-agent dispatch
- No unattended cron execution
- No auto-PR creation
- No external tracker updates

## Blocked Commands

- \`rm -rf\`
- \`git push --force\`
- \`DROP TABLE\`

## File Access Restrictions

- No writes outside \`.amber/\` or declared worktrees
- No reads of credential files without approval

## External Service Policy

- Allow: public registries (npm, PyPI)
- Block: unknown APIs without integration contract
` },
    { name: 'AUDIT_LOG.md', content: `# Audit Log Guide

## Timeline Inspection

\`\`\`bash
amber governance evidence --session <id> --output evidence.md
\`\`\`

## Evidence Export

Session timelines: \`.amber/sessions/*/timeline.jsonl\`
Execution evidence: \`.amber/executions/*/evidence.json\`

## Retention Policy

- Sessions: 90 days
- Executions: 180 days
- Audit reports: 1 year
` }
  ];

  const created = [];
  const skipped = [];

  for (const tmpl of templates) {
    const dest = path.join(govDir, tmpl.name);
    if (fs.existsSync(dest)) {
      skipped.push(dest);
    } else {
      fs.writeFileSync(dest, tmpl.content);
      created.push(dest);
    }
  }

  return { created, skipped };
}

function exportSessionEvidence(sessionId, targetRoot, outputPath) {
  const target = path.resolve(targetRoot);
  const timelinePath = path.join(target, '.amber', 'sessions', sessionId, 'timeline.jsonl');

  const events = readTimeline(timelinePath);
  const output = path.resolve(outputPath);

  const lines = ['# Session Evidence', '', `**Session ID:** ${sessionId}`, ''];

  const sessionCreated = events.find(e => e.type === 'session_created');
  if (sessionCreated) {
    lines.push(`**Goal:** ${sessionCreated.data.goal || 'N/A'}`);
    lines.push(`**Started:** ${sessionCreated.timestamp}`, '');
  }

  const sessionEnd = events.find(e => e.type === 'session_completed' || e.type === 'session_aborted');
  if (sessionEnd) {
    lines.push(`**Ended:** ${sessionEnd.timestamp}`, `**Status:** ${sessionEnd.type}`, '');
  }

  const commands = events.filter(e => e.type === 'command_executed');
  if (commands.length) {
    lines.push('## Commands', '');
    commands.forEach(e => lines.push(`- \`${e.data.command}\` (${e.timestamp})`));
    lines.push('');
  }

  const toolCalls = events.filter(e => e.type === 'tool_call');
  if (toolCalls.length) {
    lines.push('## Tool Calls', '');
    toolCalls.forEach(e => lines.push(`- ${e.data.tool} (${e.timestamp})`));
    lines.push('');
  }

  const gates = events.filter(e => ['gate_triggered', 'gate_passed', 'gate_failed'].includes(e.type));
  if (gates.length) {
    lines.push('## Approval Gates', '');
    gates.forEach(e => lines.push(`- ${e.type}: ${e.data?.gate || 'N/A'} (${e.timestamp})`));
    lines.push('');
  }

  const errors = events.filter(e => e.type === 'error' || e.type === 'stage_failed');
  if (errors.length) {
    lines.push('## Errors', '');
    errors.forEach(e => lines.push(`- ${e.data?.message || e.data?.error || 'Unknown error'} (${e.timestamp})`));
    lines.push('');
  }

  const budget = events.filter(e => ['budget_warning', 'budget_exceeded'].includes(e.type));
  if (budget.length) {
    lines.push('## Budget', '');
    budget.forEach(e => lines.push(`- ${e.type}: ${e.data?.message || 'N/A'} (${e.timestamp})`));
    lines.push('');
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, lines.join('\n'));

  return { exported: true, events: events.length, outputPath: output };
}

function exportExecutionEvidence(taskId, targetRoot, outputPath) {
  const target = path.resolve(targetRoot);
  const execDir = path.join(target, '.amber', 'executions', taskId);
  const ledgerPath = path.join(execDir, 'ledger.json');
  const evidencePath = path.join(execDir, 'evidence.json');

  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : null;
  const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null;

  const output = path.resolve(outputPath);
  const lines = ['# Execution Evidence', '', `**Task ID:** ${taskId}`, ''];

  if (ledger) {
    if (ledger.plan) lines.push(`**Plan:** ${ledger.plan}`, '');
    if (ledger.status) lines.push(`**Status:** ${ledger.status}`, '');
    if (ledger.worktree) lines.push(`**Worktree:** ${ledger.worktree}`, '');
  }

  if (evidence?.commands?.length) {
    lines.push('## Commands', '');
    evidence.commands.forEach(cmd => lines.push(`- \`${cmd}\``));
    lines.push('');
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, lines.join('\n'));

  return { exported: true, outputPath: output };
}

function inspectPolicy(targetRoot) {
  const policy = loadPolicy(targetRoot);
  const defaults = getDefaultPolicy();
  const overrides = [];
  const errors = [];
  const warnings = [];

  if (policy.hasOwnProperty('auto-approve-all')) {
    errors.push("auto-approve-all is a CLI flag, not a policy setting");
  }

  if (policy.gates) {
    for (const [gate, action] of Object.entries(policy.gates)) {
      if (defaults.gates[gate] && defaults.gates[gate] !== action) {
        overrides.push({ type: 'gate', gate, default: defaults.gates[gate], override: action });
      }
      if (gate === "user-approval" && action === "approve") {
        warnings.push("Unsafe: gates['user-approval'] === 'approve' bypasses human approval");
      }
    }
  }

  if (policy.retry && JSON.stringify(policy.retry) !== JSON.stringify(defaults.retry)) {
    overrides.push({ type: 'retry', default: defaults.retry, override: policy.retry });
  }

  if (policy.budget && JSON.stringify(policy.budget) !== JSON.stringify(defaults.budget)) {
    overrides.push({ type: 'budget', default: defaults.budget, override: policy.budget });
  }

  return { policy, defaults, overrides, errors, warnings };
}

function generateAuditReport(targetRoot, outputPath, options = {}) {
  const target = path.resolve(targetRoot);
  const sessionsDir = path.join(target, '.amber', 'sessions');
  const executionsDir = path.join(target, '.amber', 'executions');
  const output = path.resolve(outputPath);

  const lines = ['# Audit Report', '', `**Generated:** ${new Date().toISOString()}`, ''];

  // Section 1: Policy snapshot
  lines.push('## 1. Policy Snapshot', '');
  const { policy, overrides, errors, warnings } = inspectPolicy(targetRoot);
  lines.push('```json', JSON.stringify(policy, null, 2), '```', '');
  if (overrides.length) {
    lines.push('**Overrides:**', '');
    overrides.forEach(o => lines.push(`- ${o.type}: ${JSON.stringify(o.override)}`));
    lines.push('');
  }
  if (errors.length) {
    lines.push('**Errors:**', '');
    errors.forEach(e => lines.push(`- ${e}`));
    lines.push('');
  }
  if (warnings.length) {
    lines.push('**Warnings:**', '');
    warnings.forEach(w => lines.push(`- ${w}`));
    lines.push('');
  }

  // Section 2: Session summary
  lines.push('## 2. Session Summary', '');
  const sessions = [];
  if (fs.existsSync(sessionsDir)) {
    const sessionIds = fs.readdirSync(sessionsDir).filter(f => fs.statSync(path.join(sessionsDir, f)).isDirectory());
    for (const id of sessionIds) {
      const timelinePath = path.join(sessionsDir, id, 'timeline.jsonl');
      if (!fs.existsSync(timelinePath)) continue;

      const events = readTimeline(timelinePath);
      const created = events.find(e => e.type === 'session_created');
      const end = events.find(e => e.type === 'session_completed' || e.type === 'session_aborted');
      const commands = events.filter(e => e.type === 'command_executed').length;
      const approvals = events.filter(e => e.type === 'gate_triggered' || e.type === 'gate_passed').length;

      if (options.since && created?.timestamp) {
        if (new Date(created.timestamp) < new Date(options.since)) continue;
      }

      sessions.push({
        id,
        goal: created?.data?.goal || 'N/A',
        start: created?.timestamp || 'N/A',
        end: end?.timestamp || 'N/A',
        commands,
        approvals,
        status: end ? end.type.replace('session_', '') : 'running'
      });
    }
  }

  lines.push('| ID | Goal | Start | End | Commands | Approvals | Status |');
  lines.push('|----|------|-------|-----|----------|-----------|--------|');
  sessions.forEach(s => {
    const shortId = s.id.slice(0, 8);
    const shortGoal = s.goal.length > 30 ? s.goal.slice(0, 27) + '...' : s.goal;
    lines.push(`| ${shortId} | ${shortGoal} | ${s.start} | ${s.end} | ${s.commands} | ${s.approvals} | ${s.status} |`);
  });
  lines.push('');

  // Section 3: Execution summary
  lines.push('## 3. Execution Summary', '');
  const executions = [];
  if (fs.existsSync(executionsDir)) {
    const taskIds = fs.readdirSync(executionsDir).filter(f => fs.statSync(path.join(executionsDir, f)).isDirectory());
    for (const id of taskIds) {
      const ledgerPath = path.join(executionsDir, id, 'ledger.json');
      const evidencePath = path.join(executionsDir, id, 'evidence.json');

      if (!fs.existsSync(ledgerPath)) continue;

      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null;
      const commands = evidence?.commands?.length || 0;

      executions.push({
        id,
        plan: ledger.plan || 'N/A',
        status: ledger.status || 'N/A',
        commands
      });
    }
  }

  lines.push('| Task ID | Plan | Status | Commands |');
  lines.push('|---------|------|--------|----------|');
  executions.forEach(e => {
    const shortId = e.id.slice(0, 8);
    const shortPlan = e.plan.length > 40 ? e.plan.slice(0, 37) + '...' : e.plan;
    lines.push(`| ${shortId} | ${shortPlan} | ${e.status} | ${e.commands} |`);
  });
  lines.push('');

  // Section 4: Retention compliance
  lines.push('## 4. Retention Compliance', '');
  const retentionDays = policy.retention?.sessionDays;
  if (retentionDays) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const oldSessions = sessions.filter(s => s.start !== 'N/A' && new Date(s.start) < cutoff);
    const oldExecutions = executions.filter(e => {
      const ledgerPath = path.join(executionsDir, e.id, 'ledger.json');
      const stat = fs.statSync(ledgerPath);
      return stat.mtime < cutoff;
    });

    lines.push(`**Retention policy:** ${retentionDays} days`, '');
    lines.push(`- Sessions older than cutoff: ${oldSessions.length}`);
    lines.push(`- Executions older than cutoff: ${oldExecutions.length}`);
  } else {
    lines.push('**No retention policy set.**');
  }
  lines.push('');

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, lines.join('\n'));

  return {
    sections: 4,
    sessions: sessions.length,
    executions: executions.length,
    outputPath: output
  };
}

module.exports = { governanceDocs, exportSessionEvidence, exportExecutionEvidence, inspectPolicy, generateAuditReport };
