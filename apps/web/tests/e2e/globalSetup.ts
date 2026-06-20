import path from 'path';
import { seedFixtureSession } from './fixtures/seed';

// Playwright runs from apps/web (config dir), matching the server's cwd. The
// server reads .amber via cwd/../../.amber, so the repo root is two levels up.
export default function globalSetup(): void {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  seedFixtureSession(repoRoot);
}
