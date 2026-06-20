import path from 'path';
import { removeFixtureSession } from './fixtures/seed';

export default function globalTeardown(): void {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  removeFixtureSession(repoRoot);
}
