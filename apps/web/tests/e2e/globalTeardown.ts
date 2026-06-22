import path from 'path';
import { removeFixtureSession } from './fixtures/seed';

export default function globalTeardown(): void {
  const repoRoot = process.env.AMBER_REPO_ROOT || path.resolve(process.cwd(), '..', '..');
  removeFixtureSession(repoRoot);
}
