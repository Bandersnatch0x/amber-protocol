import fs from 'fs';
import os from 'os';
import path from 'path';
import { getE2EClaudeHome, removeE2ETranscriptFixture } from './fixtures/transcript-fixture';

// Inline functions to avoid TypeScript import resolution issues
function getE2ERepoRoot(): string {
  const override = process.env.AMBER_E2E_REPO_ROOT;
  if (override) return path.resolve(override);

  const repoKey = path.resolve(process.cwd(), '..', '..').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `amber-web-e2e-${repoKey}`);
}

function removeE2ERepoRoot(): void {
  const fixtureRoot = getE2ERepoRoot();
  const tmpRoot = path.resolve(os.tmpdir());
  const resolvedFixture = path.resolve(fixtureRoot);

  if (!resolvedFixture.startsWith(tmpRoot + path.sep)) {
    throw new Error(`Refusing to remove non-temp E2E fixture root: ${resolvedFixture}`);
  }

  fs.rmSync(resolvedFixture, { recursive: true, force: true });
}

export default function globalTeardown(): void {
  removeE2ERepoRoot();
  removeE2ETranscriptFixture(getE2EClaudeHome());
}
