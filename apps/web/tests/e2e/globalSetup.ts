import { seedFixtureSession } from './fixtures/seed';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Inline functions to avoid TypeScript import resolution issues
function getE2ERepoRoot(): string {
  const override = process.env.AMBER_E2E_REPO_ROOT;
  if (override) return path.resolve(override);

  const repoKey = path.resolve(process.cwd(), '..', '..').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `amber-web-e2e-${repoKey}`);
}

function prepareE2ERepoRoot(): string {
  const fixtureRoot = getE2ERepoRoot();
  const sourceRoot = path.resolve(process.cwd(), '..', '..');

  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureRoot, 'package.json'),
    JSON.stringify({ name: 'amber-protocol' }, null, 2),
  );
  fs.cpSync(path.join(sourceRoot, 'routes'), path.join(fixtureRoot, 'routes'), {
    recursive: true,
  });

  return fixtureRoot;
}

export default function globalSetup(): void {
  const repoRoot = prepareE2ERepoRoot();
  seedFixtureSession(repoRoot);
}
