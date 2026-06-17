import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { proposeRegressionsFromTranscript } from '../server/lib/regression-evidence';

const JSONL = [
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'npm test' } }],
    },
    timestamp: '2026-06-17T10:00:00Z',
  }),
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'AssertionError: expected 2 got 3' }],
    },
    timestamp: '2026-06-17T10:00:01Z',
  }),
].join('\n');

describe('proposeRegressionsFromTranscript', () => {
  let claudeHome: string;
  let repoRoot: string;
  const repoPath = 'D:\\work\\demo-repo';
  const encoded = 'D--work-demo-repo';

  beforeEach(() => {
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-rge-home-'));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-rge-repo-'));
    const projectDir = path.join(claudeHome, '.claude', 'projects', encoded);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'sess-1.jsonl'), JSONL);
  });

  afterEach(() => {
    fs.rmSync(claudeHome, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes evidence.json under .amber/executions for each failure', () => {
    const result = proposeRegressionsFromTranscript('sess-1', { repoPath, repoRoot, claudeHome });
    expect(result.proposedCount).toBe(1);

    const evidencePath = result.files[0];
    expect(fs.existsSync(evidencePath)).toBe(true);
    expect(evidencePath.replace(/\\/g, '/')).toContain('.amber/executions/');
  });

  it('produces evidence matching the regression-proposal contract', () => {
    const result = proposeRegressionsFromTranscript('sess-1', { repoPath, repoRoot, claudeHome });
    const data = JSON.parse(fs.readFileSync(result.files[0], 'utf8'));

    expect(data.regressionProposal.status).toBe('proposed');
    expect(typeof data.regressionProposal.assertion).toBe('string');
    expect(data.regressionProposal.assertion.length).toBeGreaterThan(0);
    expect(data.traceReplay.traceInput).toContain('npm test');
    // Must never claim to modify the test suite.
    expect(data.regressionProposal.modifiesTests).not.toBe(true);
  });

  it('reports zero proposals when the transcript has no failures', () => {
    fs.writeFileSync(
      path.join(claudeHome, '.claude', 'projects', encoded, 'clean.jsonl'),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
    );
    const result = proposeRegressionsFromTranscript('clean', { repoPath, repoRoot, claudeHome });
    expect(result.proposedCount).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('returns null-ish (no proposals, no throw) for an unknown transcript id', () => {
    const result = proposeRegressionsFromTranscript('nope', { repoPath, repoRoot, claudeHome });
    expect(result.proposedCount).toBe(0);
  });
});
