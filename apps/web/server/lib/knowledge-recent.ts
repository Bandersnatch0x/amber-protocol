import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import type { RecentChangeItem } from '../../src/lib/knowledge-dto';
import { listGates } from './gate-reader';
import { listRoutes } from './route-reader';
import { readSessionList } from './session-reader';
import { listTranscripts } from './transcript-service';

const requireCli = createRequire(import.meta.url);
const { buildKnowledgeGraph } = requireCli('../../../../scripts/lib/core/knowledge-graph.js') as {
  buildKnowledgeGraph: (target: string) => RawGraph;
};
const { inspectMaintenance } = requireCli('../../../../scripts/lib/core/maintenance.js') as {
  inspectMaintenance: (target: string, registryPath?: string) => MaintenanceInspection;
};

const execFileAsync = promisify(execFile);
export const GIT_EXECUTABLE = 'git';
export const GIT_RECENT_ARGS = [
  'log',
  '-n',
  '20',
  '--pretty=format:%H%x1f%cI%x1f%s',
  '--date=iso-strict',
  '--',
  '.',
] as const;
export const FEATURE_HISTORY_ARGS = [
  'log',
  '-n',
  '20',
  '--pretty=format:%H%x1f%cI%x1f%s',
  '--date=iso-strict',
  '--',
  'feature_list.json',
] as const;
export const RECENT_CHANGES_LIMIT = 50;

interface RawGraph {
  drift: RawDrift[];
}

interface RawDrift {
  nodeId: string;
  kind: string;
  path: string;
  detail: string;
  actualPath?: string;
}

interface MaintenanceInspection {
  staleDocs?: Array<{ path?: unknown; reason?: unknown }>;
  wikiLint?: { errors?: unknown[]; warnings?: unknown[] };
  rulePackDrift?: { drifted?: unknown; diff?: unknown[] };
  evolutionRollup?: Array<{ text?: unknown }>;
  regressionProposals?: Array<{ taskId?: unknown; assertion?: unknown }>;
  scaffoldDrift?: { files?: Array<{ path?: unknown; classification?: unknown }> };
  artifactDrift?: {
    available?: unknown;
    features?: Array<{ id?: unknown; classification?: unknown }>;
  };
  errors?: unknown[];
  warnings?: unknown[];
}

export interface LiveLinkSources {
  sessionIds: ReadonlySet<string>;
  gateIds: ReadonlySet<string>;
  transcriptIds: ReadonlySet<string>;
  routeIds: ReadonlySet<string>;
  featureIds: ReadonlySet<string>;
}

type ExecGit = (
  executable: string,
  args: readonly string[],
  options: { cwd: string; encoding: 'utf8'; windowsHide: true; maxBuffer: number },
) => Promise<{ stdout: string }>;

function stableId(source: RecentChangeItem['source'], key: string): string {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return `${source}:${digest}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toMaintenanceItem(key: string, title: string): RecentChangeItem {
  return {
    id: stableId('maintenance', key),
    source: 'maintenance',
    title,
    time: '',
  };
}

function parseGitChanges(stdout: string, source: 'git' | 'feature'): RecentChangeItem[] {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const [hash, committedAt, ...subjectParts] = line.split('\x1f');
      const subject = subjectParts.join('\x1f').trim();
      if (!hash || !committedAt || !subject || !Number.isFinite(Date.parse(committedAt))) {
        return [];
      }
      return [{ id: `${source}:${hash}`, source, title: subject, time: committedAt }];
    });
}

async function runGitHistory(
  repoRoot: string,
  args: readonly string[],
  source: 'git' | 'feature',
  run: ExecGit,
): Promise<RecentChangeItem[]> {
  try {
    const { stdout } = await run(GIT_EXECUTABLE, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return parseGitChanges(stdout, source);
  } catch {
    return [];
  }
}

export function collectGitChanges(
  repoRoot: string,
  run: ExecGit = execFileAsync as unknown as ExecGit,
): Promise<RecentChangeItem[]> {
  return runGitHistory(repoRoot, GIT_RECENT_ARGS, 'git', run);
}

export function collectFeatureChanges(
  repoRoot: string,
  run: ExecGit = execFileAsync as unknown as ExecGit,
): Promise<RecentChangeItem[]> {
  return runGitHistory(repoRoot, FEATURE_HISTORY_ARGS, 'feature', run);
}

function readFeatureIds(repoRoot: string): Set<string> {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'feature_list.json'), 'utf8'),
    ) as {
      features?: Array<{ id?: unknown }>;
    };
    return new Set(
      (parsed.features ?? [])
        .map((feature) => text(feature.id))
        .filter((id): id is string => id !== null),
    );
  } catch {
    return new Set();
  }
}

export function collectAdrChanges(repoRoot: string): RecentChangeItem[] {
  const adrRoot = path.join(repoRoot, 'docs', 'adr');
  let names: string[];
  try {
    names = fs
      .readdirSync(adrRoot)
      .filter((name) => name.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }

  return names.flatMap((name) => {
    const content = fs.readFileSync(path.join(adrRoot, name), 'utf8');
    const date = content.match(/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (!date || !title || !Number.isFinite(Date.parse(date))) return [];
    return [
      {
        id: `adr:${name.replace(/\.md$/, '')}:${date}`,
        source: 'adr' as const,
        title,
        time: date,
        linkTo: 'governance' as const,
      },
    ];
  });
}

export function collectDriftChanges(drift: RawDrift[]): RecentChangeItem[] {
  return drift
    .map((finding) => ({
      id: stableId('drift', `${finding.nodeId}\n${finding.path}\n${finding.detail}`),
      source: 'drift' as const,
      title: finding.detail,
      time: '',
      linkLabel: finding.nodeId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function collectMaintenanceChanges(inspection: MaintenanceInspection): RecentChangeItem[] {
  const items: RecentChangeItem[] = [];
  const add = (key: string, value: unknown) => {
    const title = text(value);
    if (title) items.push(toMaintenanceItem(key, title));
  };

  for (const finding of inspection.staleDocs ?? []) {
    const filePath = text(finding.path);
    const reason = text(finding.reason);
    if (filePath && reason) add(`stale:${filePath}`, `${filePath}: ${reason}`);
  }
  for (const [index, finding] of (inspection.wikiLint?.errors ?? []).entries()) {
    add(`wiki-error:${index}`, finding);
  }
  for (const [index, finding] of (inspection.wikiLint?.warnings ?? []).entries()) {
    add(`wiki-warning:${index}`, finding);
  }
  for (const [index, finding] of (inspection.evolutionRollup ?? []).entries()) {
    add(`evolution:${index}`, finding.text);
  }
  for (const finding of inspection.regressionProposals ?? []) {
    add(`regression:${text(finding.taskId) ?? items.length}`, finding.assertion);
  }
  for (const finding of inspection.scaffoldDrift?.files ?? []) {
    const filePath = text(finding.path);
    const classification = text(finding.classification);
    if (filePath && classification && classification !== 'fresh') {
      add(`scaffold:${filePath}`, `${filePath}: ${classification}`);
    }
  }
  if (inspection.artifactDrift?.available) {
    for (const finding of inspection.artifactDrift.features ?? []) {
      const id = text(finding.id);
      const classification = text(finding.classification);
      if (id && classification === 'drifted') add(`artifact:${id}`, `${id}: ${classification}`);
    }
  }
  if (inspection.rulePackDrift?.drifted) {
    for (const finding of inspection.rulePackDrift.diff ?? []) {
      add(`rule-pack:${String(finding)}`, finding);
    }
  }
  for (const [index, finding] of (inspection.errors ?? []).entries()) {
    add(`error:${index}`, finding);
  }
  for (const [index, finding] of (inspection.warnings ?? []).entries()) {
    add(`warning:${index}`, finding);
  }

  return items.sort((left, right) => left.id.localeCompare(right.id));
}

function containsId(title: string, id: string): boolean {
  if (!id) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`, 'i').test(title);
}

export function attachVerifiedLink(
  item: RecentChangeItem,
  sources: LiveLinkSources,
): RecentChangeItem {
  const candidates: Array<[RecentChangeItem['linkTo'], ReadonlySet<string>]> = [
    ['sessions', sources.sessionIds],
    ['gates', sources.gateIds],
    ['transcripts', sources.transcriptIds],
    ['routes', sources.routeIds],
    ['governance', sources.featureIds],
  ];

  const searchable = `${item.title} ${item.linkLabel ?? ''}`;
  for (const [linkTo, ids] of candidates) {
    const linkId = [...ids].sort().find((id) => containsId(searchable, id));
    if (linkId) return { ...item, linkTo, linkId, linkLabel: linkId };
  }

  if (item.linkTo === 'governance' && item.linkId === undefined) return item;
  const withoutInvalidTarget = { ...item };
  delete withoutInvalidTarget.linkTo;
  delete withoutInvalidTarget.linkId;
  return withoutInvalidTarget;
}

export function orderAndCapRecentChanges(
  items: RecentChangeItem[],
  limit = RECENT_CHANGES_LIMIT,
): RecentChangeItem[] {
  const drift = items
    .filter((item) => item.source === 'drift')
    .sort((left, right) => left.id.localeCompare(right.id));
  const dated = items
    .filter((item) => item.source !== 'drift' && Number.isFinite(Date.parse(item.time)))
    .sort((left, right) => {
      const timeOrder = Date.parse(right.time) - Date.parse(left.time);
      return timeOrder || left.id.localeCompare(right.id);
    });
  const undated = items
    .filter((item) => item.source !== 'drift' && !Number.isFinite(Date.parse(item.time)))
    .sort((left, right) => left.id.localeCompare(right.id));

  return [...drift, ...dated, ...undated].slice(0, limit);
}

export async function listRecentChanges(repoRoot: string): Promise<RecentChangeItem[]> {
  const [git, features, gates] = await Promise.all([
    collectGitChanges(repoRoot),
    collectFeatureChanges(repoRoot),
    listGates(),
  ]);
  const adrs = collectAdrChanges(repoRoot);
  const drift = collectDriftChanges(buildKnowledgeGraph(repoRoot).drift);
  const maintenance = collectMaintenanceChanges(inspectMaintenance(repoRoot));
  const liveSources: LiveLinkSources = {
    sessionIds: new Set(readSessionList().map((session) => session.id)),
    gateIds: new Set(gates.map((gate) => gate.gateId)),
    transcriptIds: new Set(
      listTranscripts({ repoPath: repoRoot }).map((transcript) => transcript.id),
    ),
    routeIds: new Set(listRoutes().map((route) => route.id)),
    featureIds: readFeatureIds(repoRoot),
  };

  return orderAndCapRecentChanges(
    [...drift, ...maintenance, ...git, ...features, ...adrs].map((item) =>
      attachVerifiedLink(item, liveSources),
    ),
  );
}
