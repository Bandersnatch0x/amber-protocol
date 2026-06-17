import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveTranscriptDigest } from '../server/lib/lens-store';

const FIXTURE_JSONL = [
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'set GITHUB_TOKEN=ghp_1234567890abcdefABCDEF1234567890abcd then continue' },
    timestamp: '2026-06-17T10:00:00Z',
  }),
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'understood' }] },
    timestamp: '2026-06-17T10:00:01Z',
  }),
].join('\n');

describe('lens-store', () => {
  let claudeHome: string;
  let repoRoot: string;
  const repoPath = 'D:\\work\\demo-repo';
  const encoded = 'D--work-demo-repo';

  beforeEach(() => {
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-lens-home-'));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-lens-repo-'));
    const projectDir = path.join(claudeHome, '.claude', 'projects', encoded);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'sess-1.jsonl'), FIXTURE_JSONL);
  });

  afterEach(() => {
    fs.rmSync(claudeHome, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes a digest under .amber/lens', () => {
    const result = saveTranscriptDigest('sess-1', { repoPath, repoRoot, claudeHome });
    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.path)).toBe(true);
    expect(result!.path.replace(/\\/g, '/')).toContain('.amber/lens/');
  });

  it('never writes raw secrets to the saved digest', () => {
    const result = saveTranscriptDigest('sess-1', { repoPath, repoRoot, claudeHome });
    const written = fs.readFileSync(result!.path, 'utf8');
    expect(written).not.toContain('ghp_1234567890abcdefABCDEF1234567890abcd');
    expect(written).toContain('[REDACTED');
  });

  it('creates .amber/lens/.gitignore that ignores the directory', () => {
    saveTranscriptDigest('sess-1', { repoPath, repoRoot, claudeHome });
    const gitignorePath = path.join(repoRoot, '.amber', 'lens', '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, 'utf8')).toContain('*');
  });

  it('returns null for an unknown transcript id', () => {
    const result = saveTranscriptDigest('nope', { repoPath, repoRoot, claudeHome });
    expect(result).toBeNull();
  });
});
