/**
 * Turn failed tool calls from a Claude Code transcript into regression-test
 * PROPOSALS — the long-missing trace source for Amber's existing
 * failure-to-regression flow (maintenance.js readRegressionProposal).
 *
 * It writes `.amber/executions/<id>/evidence.json` in the exact shape that
 * `amber maintenance propose` already consumes. It NEVER modifies the test
 * suite: it only proposes (status "proposed", modifiesTests false). Human
 * review via `maintenance propose` stays the gate.
 */

import fs from 'fs';
import path from 'path';
import {
  extractFailures,
  encodeProjectPath,
  resolveClaudeProjectsDir,
  type TranscriptFailure,
} from './claude-transcript-reader';
import { AMBER_STATE_DIR } from './state-dir';

export interface RegressionEvidenceOptions {
  repoPath: string;
  repoRoot: string;
  claudeHome?: string;
}

export interface RegressionEvidenceResult {
  transcriptId: string;
  proposedCount: number;
  files: string[];
}

function assertionFor(failure: TranscriptFailure): string {
  const firstLine = failure.error.split('\n').find((l) => l.trim().length > 0) ?? 'the failing command';
  return `Re-running \`${failure.tool}\` with the recorded input should not fail with: ${firstLine.trim()}`;
}

function buildEvidence(transcriptId: string, index: number, failure: TranscriptFailure) {
  return {
    taskId: `${transcriptId}-failure-${index + 1}`,
    plan: '',
    source: 'session-lens-transcript',
    traceReplay: {
      traceInput: failure.input,
      agentConfig: '',
      tool: failure.tool,
      timestamp: failure.timestamp ?? null,
    },
    regressionProposal: {
      status: 'proposed',
      assertion: assertionFor(failure),
      modifiesTests: false,
      approvalRequired: true,
    },
  };
}

export function proposeRegressionsFromTranscript(
  id: string,
  opts: RegressionEvidenceOptions,
): RegressionEvidenceResult {
  const failures = readRawFailures(opts, id);
  if (failures.length === 0) {
    return { transcriptId: id, proposedCount: 0, files: [] };
  }

  const executionsRoot = path.join(opts.repoRoot, AMBER_STATE_DIR, 'executions');
  const files: string[] = [];

  failures.forEach((failure, index) => {
    const taskDir = path.join(executionsRoot, `${id}-failure-${index + 1}`);
    fs.mkdirSync(taskDir, { recursive: true });
    const evidencePath = path.join(taskDir, 'evidence.json');
    fs.writeFileSync(evidencePath, `${JSON.stringify(buildEvidence(id, index, failure), null, 2)}\n`);
    files.push(evidencePath);
  });

  return { transcriptId: id, proposedCount: files.length, files };
}

function readRawFailures(opts: RegressionEvidenceOptions, id: string): TranscriptFailure[] {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    return [];
  }
  const projectsDir = resolveClaudeProjectsDir(opts.claudeHome);
  const filePath = path.join(projectsDir, encodeProjectPath(opts.repoPath), `${id}.jsonl`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return extractFailures(fs.readFileSync(filePath, 'utf8'));
}
