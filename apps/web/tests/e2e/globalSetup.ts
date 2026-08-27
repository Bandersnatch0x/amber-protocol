import { seedFixtureSession } from './fixtures/seed';
import { getE2EClaudeHome, seedE2ETranscriptFixture } from './fixtures/transcript-fixture';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';

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

  const featureListPath = path.join(fixtureRoot, 'feature_list.json');
  const featureList = JSON.parse(fs.readFileSync(featureListPath, 'utf8')) as {
    features: Array<{ id: string; paths?: string[] }>;
  };
  for (const feature of featureList.features) {
    if (feature.id !== 'F001' && feature.id !== 'F007') feature.paths = [];
  }
  fs.writeFileSync(featureListPath, JSON.stringify(featureList, null, 2));

  return fixtureRoot;
}

function seedFeatureHistory(repoRoot: string): void {
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
  const featureListPath = path.join(repoRoot, 'feature_list.json');

  for (let day = 1; day <= 25; day += 1) {
    fs.appendFileSync(featureListPath, ' ');
    execFileSync('git', ['add', '--', 'feature_list.json'], { cwd: repoRoot });
    const timestamp = `2026-08-${String(day).padStart(2, '0')}T12:00:00Z`;
    execFileSync(
      'git',
      ['commit', '--quiet', '-m', `chore(features): record state update ${day}`],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Amber E2E',
          GIT_AUTHOR_EMAIL: 'amber-e2e@example.invalid',
          GIT_AUTHOR_DATE: timestamp,
          GIT_COMMITTER_NAME: 'Amber E2E',
          GIT_COMMITTER_EMAIL: 'amber-e2e@example.invalid',
          GIT_COMMITTER_DATE: timestamp,
        },
      },
    );
  }
}

export default function globalSetup(): void {
  const repoRoot = prepareE2ERepoRoot();
  seedFeatureHistory(repoRoot);
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
