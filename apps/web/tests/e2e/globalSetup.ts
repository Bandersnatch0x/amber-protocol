import { seedFixtureSession } from './fixtures/seed';
import { getE2EClaudeHome, seedE2ETranscriptFixture } from './fixtures/transcript-fixture';
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

function assertTempFixtureRoot(fixtureRoot: string): string {
  const tmpRoot = path.resolve(os.tmpdir());
  const resolvedFixture = path.resolve(fixtureRoot);

  if (!resolvedFixture.startsWith(tmpRoot + path.sep)) {
    throw new Error(`Refusing to prepare non-temp E2E fixture root: ${resolvedFixture}`);
  }

  return resolvedFixture;
}

function prepareE2ERepoRoot(): string {
  const fixtureRoot = assertTempFixtureRoot(getE2ERepoRoot());
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

  // Seed knowledge-graph source files so /knowledge renders real data in E2E.
  const knowledgeDirs: string[][] = [
    ['docs', 'adr'],
    ['docs', 'wiki', 'knowledge'],
    ['docs', 'architecture'],
  ];
  for (const parts of knowledgeDirs) {
    const srcDir = path.join(sourceRoot, ...parts);
    const dstDir = path.join(fixtureRoot, ...parts);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, dstDir, { recursive: true });
    }
  }
  for (const file of ['feature_list.json', 'MEMORY.md']) {
    const srcFile = path.join(sourceRoot, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(fixtureRoot, file));
    }
  }

  return fixtureRoot;
}

export default function globalSetup(): void {
  const repoRoot = prepareE2ERepoRoot();
  seedFixtureSession(repoRoot);

  // Hermetic Claude home for the transcript timeline fixture (read path only;
  // the web server picks it up via AMBER_CLAUDE_HOME from playwright.config).
  const claudeHome = getE2EClaudeHome();
  if (!path.resolve(claudeHome).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error(`Refusing to prepare non-temp E2E Claude home: ${claudeHome}`);
  }
  fs.rmSync(claudeHome, { recursive: true, force: true });
  seedE2ETranscriptFixture(repoRoot, claudeHome);
}
