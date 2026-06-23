import { seedFixtureSession } from './fixtures/seed';
import { prepareE2ERepoRoot } from './fixtures/repo-root';

export default function globalSetup(): void {
  const repoRoot = prepareE2ERepoRoot();
  seedFixtureSession(repoRoot);
}
