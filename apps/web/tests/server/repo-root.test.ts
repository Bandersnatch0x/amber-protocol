import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRepoRoot } from '@server/lib/repo-root';

const originalRepoRoot = process.env.AMBER_REPO_ROOT;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'amber-repo-root-'));
}

function writeRepoMarker(root: string): void {
  fs.mkdirSync(path.join(root, 'routes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'amber-protocol' }),
  );
}

afterEach(() => {
  if (originalRepoRoot === undefined) {
    delete process.env.AMBER_REPO_ROOT;
  } else {
    process.env.AMBER_REPO_ROOT = originalRepoRoot;
  }
});

describe('resolveRepoRoot', () => {
  it('walks up from nested app directories to the repository root', () => {
    const root = tempDir();
    try {
      writeRepoMarker(root);
      const nested = path.join(root, 'apps', 'web');
      fs.mkdirSync(nested, { recursive: true });

      expect(resolveRepoRoot(nested)).toBe(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows AMBER_REPO_ROOT to override cwd-based discovery', () => {
    const root = tempDir();
    try {
      process.env.AMBER_REPO_ROOT = root;

      expect(resolveRepoRoot('/tmp/not-the-app')).toBe(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
