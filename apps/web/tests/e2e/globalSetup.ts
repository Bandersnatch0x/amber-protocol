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
  // docs/knowledge-corpus is the committed context projection the graph
  // reader has required since the F059 T7 unification; without it every
  // /knowledge load fails with AMBER_E_PROJECTION_MISSING.
  const knowledgeDirs: string[][] = [
    ['docs', 'adr'],
    ['docs', 'wiki', 'knowledge'],
    ['docs', 'architecture'],
    ['docs', 'knowledge-corpus'],
    ['docs', 'specs'],
    ['schemas'],
  ];
  for (const parts of knowledgeDirs) {
    const srcDir = path.join(sourceRoot, ...parts);
    const dstDir = path.join(fixtureRoot, ...parts);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, dstDir, { recursive: true });
    }
  }

  // F060 code layer: the fixture carries the real product code corpus so the
  // schemaVersion 2 graph has Code Nodes, imports edges, and anchors edges —
  // fold/expansion, pierce-search, and shared-foundation e2e run against
  // live extraction. node_modules and build output never enter.
  const codeDirs: string[][] = [
    ['scripts'],
    ['src'],
    ['apps', 'web', 'src'],
    ['apps', 'web', 'server'],
  ];
  for (const parts of codeDirs) {
    const srcDir = path.join(sourceRoot, ...parts);
    const dstDir = path.join(fixtureRoot, ...parts);
    if (!fs.existsSync(srcDir)) continue;
    fs.cpSync(srcDir, dstDir, {
      recursive: true,
      filter: (source) => {
        const base = path.basename(source);
        return base !== 'node_modules' && base !== 'dist' && base !== 'output';
      },
    });
  }
  for (const tsconfigName of fs
    .readdirSync(path.join(sourceRoot, 'apps', 'web'))
    .filter((name) => /^tsconfig.*\.json$/.test(name))) {
    fs.copyFileSync(
      path.join(sourceRoot, 'apps', 'web', tsconfigName),
      path.join(fixtureRoot, 'apps', 'web', tsconfigName),
    );
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
  // F001/F007 keep intentional standing dead anchors for the e2e dead-anchor
  // / drift contracts. The live feature_list paths were corrected in F062
  // (scaffold.js / loops.js), so reinject the historical dead paths here only.
  // F059 keeps real paths so the F060 fold/expansion e2e exercises live
  // anchors edges.
  const standingDeadAnchors: Record<string, string[]> = {
    F001: ['scripts/lib/core/scaffolding.js'],
    F007: ['scripts/lib/core/loops/'],
  };
  const keepPaths = new Set(['F001', 'F007', 'F059']);
  for (const feature of featureList.features) {
    if (standingDeadAnchors[feature.id]) {
      feature.paths = standingDeadAnchors[feature.id];
    } else if (!keepPaths.has(feature.id)) {
      feature.paths = [];
    }
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
