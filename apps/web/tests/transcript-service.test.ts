import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listTranscripts, readTranscript } from '../server/lib/transcript-service';

const FIXTURE_JSONL = [
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'echo DATABASE_PASSWORD=secret-val-123' },
    timestamp: '2026-06-17T10:00:00Z',
  }),
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    timestamp: '2026-06-17T10:00:01Z',
  }),
].join('\n');

describe('transcript-service', () => {
  let claudeHome: string;
  const repoPath = 'D:\\work\\demo-repo';
  const encoded = 'D--work-demo-repo';

  beforeEach(() => {
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-lens-svc-'));
    const projectDir = path.join(claudeHome, '.claude', 'projects', encoded);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'sess-1.jsonl'), FIXTURE_JSONL);
  });

  afterEach(() => {
    fs.rmSync(claudeHome, { recursive: true, force: true });
  });

  it('lists transcripts for the resolved repo', () => {
    const list = listTranscripts({ repoPath, claudeHome });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sess-1');
  });

  it('redacts secrets by default at the web service boundary', () => {
    const detail = readTranscript('sess-1', { repoPath, claudeHome });
    expect(detail).not.toBeNull();
    expect(JSON.stringify(detail!.turns)).not.toContain('secret-val-123');
  });

  it('returns null for an unknown transcript id', () => {
    expect(readTranscript('nope', { repoPath, claudeHome })).toBeNull();
  });
});
