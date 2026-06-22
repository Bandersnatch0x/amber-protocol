import path from 'path';
import { seedFixtureSession } from './fixtures/seed';

export default function globalSetup(): void {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  process.env.AMBER_REPO_ROOT = repoRoot;
  seedFixtureSession(repoRoot);
}
