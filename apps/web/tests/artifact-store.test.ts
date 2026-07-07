import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveRepoPath,
  resolveStatePath,
  readJsonSafe,
  readJsonSafeAsync,
  readJsonDir,
} from '../server/lib/artifact-store';

const originalRepoRoot = process.env.AMBER_REPO_ROOT;
let testRoot: string;

describe('artifact-store', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-artifact-store-'));
    process.env.AMBER_REPO_ROOT = testRoot;
  });

  afterEach(() => {
    if (originalRepoRoot === undefined) {
      delete process.env.AMBER_REPO_ROOT;
    } else {
      process.env.AMBER_REPO_ROOT = originalRepoRoot;
    }
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  describe('path resolution', () => {
    it('resolveStatePath with no segments returns the .amber dir', () => {
      expect(resolveStatePath()).toBe(path.join(testRoot, '.amber'));
    });

    it('resolveStatePath joins guarded segments under .amber', () => {
      expect(resolveStatePath('sessions', 'abc')).toBe(
        path.join(testRoot, '.amber', 'sessions', 'abc'),
      );
    });

    it('resolveStatePath rejects traversal segments', () => {
      expect(resolveStatePath('sessions', '../../etc/passwd')).toBeNull();
    });

    it('resolveRepoPath resolves under the repo root and rejects escapes', () => {
      expect(resolveRepoPath('routes')).toBe(path.join(testRoot, 'routes'));
      expect(resolveRepoPath('..')).toBeNull();
    });
  });

  describe('readJsonSafe / readJsonSafeAsync', () => {
    it('returns the parsed value for valid JSON', async () => {
      const filePath = path.join(testRoot, 'ok.json');
      fs.writeFileSync(filePath, '{"a":1}');
      expect(readJsonSafe(filePath)).toEqual({ value: { a: 1 }, error: null });
      expect(await readJsonSafeAsync(filePath)).toEqual({ value: { a: 1 }, error: null });
    });

    it('never throws: corrupt JSON and missing files yield { value: null, error }', async () => {
      const corruptPath = path.join(testRoot, 'corrupt.json');
      fs.writeFileSync(corruptPath, '{not json');
      expect(readJsonSafe(corruptPath).error).toBeInstanceOf(Error);
      expect(readJsonSafe(path.join(testRoot, 'missing.json')).error).toBeInstanceOf(Error);
      expect((await readJsonSafeAsync(corruptPath)).error).toBeInstanceOf(Error);
    });
  });

  describe('readJsonDir', () => {
    it('returns [] for a missing directory', () => {
      expect(readJsonDir(path.join(testRoot, 'nope'))).toEqual([]);
    });

    it('skips corrupt files and non-matching suffixes', () => {
      const dir = path.join(testRoot, 'routes');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'a.route.json'), '{"id":"a"}');
      fs.writeFileSync(path.join(dir, 'bad.route.json'), '{oops');
      fs.writeFileSync(path.join(dir, 'readme.md'), 'not json');

      const entries = readJsonDir(dir, { suffix: '.route.json' });
      expect(entries).toEqual([{ name: 'a', value: { id: 'a' } }]);
    });

    it('defaults to the .json suffix and strips it from names', () => {
      const dir = path.join(testRoot, 'things');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'x.json'), '{"v":2}');
      expect(readJsonDir(dir)).toEqual([{ name: 'x', value: { v: 2 } }]);
    });
  });
});
