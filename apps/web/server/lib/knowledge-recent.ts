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
const { buildKnowledgeGraph } = requireCli('../../../../scripts/lib/web-adapter.js') as {
  buildKnowledgeGraph: (target: string) => RawGraph;
};
const { inspectMaintenance } = requireCli('../../../../scripts/lib/web-adapter.js') as {
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

type GitHistorySource = 'git' | 'feature';
type GitHistoryLabel = 'git-history' | 'feature-history';

function normalizedLimit(limit: number): number {
  return Math.max(0, Math.floor(limit));
}

function compareById(left: RecentChangeItem, right: RecentChangeItem): number {
  return left.id.localeCompare(right.id);
}

function compareDatedNewest(left: RecentChangeItem, right: RecentChangeItem): number {
  const timeOrder = Date.parse(right.time) - Date.parse(left.time);
  return timeOrder || compareById(left, right);
}

function pushBounded(
  items: RecentChangeItem[],
  item: RecentChangeItem,
  limit: number,
  compare: (left: RecentChangeItem, right: RecentChangeItem) => number,
): void {
  if (limit <= 0) return;
  items.push(item);
  if (items.length > limit) {
    items.sort(compare);
    items.pop();
  }
}

function gitHistoryLabel(source: GitHistorySource): GitHistoryLabel {
  return source === 'feature' ? 'feature-history' : 'git-history';
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export class RecentChangeSourceError extends Error {
  readonly historySource: GitHistoryLabel;

  constructor(source: GitHistorySource, cause: unknown) {
    const historySource = gitHistoryLabel(source);
    super(`Failed to read ${historySource}: ${errorText(cause)}`);
    this.name = 'RecentChangeSourceError';
    this.historySource = historySource;
    Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
  }
}

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
  source: GitHistorySource,
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
  } catch (error) {
    throw new RecentChangeSourceError(source, error);
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

export function collectAdrChanges(
  repoRoot: string,
  limit = RECENT_CHANGES_LIMIT,
): RecentChangeItem[] {
  const sourceLimit = normalizedLimit(limit);
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

  const items: RecentChangeItem[] = [];
  for (const name of names) {
    const content = fs.readFileSync(path.join(adrRoot, name), 'utf8');
    const date = content.match(/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (!date || !title || !Number.isFinite(Date.parse(date))) continue;
    pushBounded(
      items,
      {
        id: `adr:${name.replace(/\.md$/, '')}:${date}`,
        source: 'adr' as const,
        title,
        time: date,
        linkTo: 'governance' as const,
      },
      sourceLimit,
      compareDatedNewest,
    );
  }

  return items.sort(compareDatedNewest);
}

export function collectDriftChanges(
  drift: RawDrift[],
  limit = RECENT_CHANGES_LIMIT,
): RecentChangeItem[] {
  const sourceLimit = normalizedLimit(limit);
  const items: RecentChangeItem[] = [];
  for (const finding of drift) {
    pushBounded(
      items,
      {
        id: stableId('drift', `${finding.nodeId}\n${finding.path}\n${finding.detail}`),
        source: 'drift' as const,
        title: finding.detail,
        time: '',
        linkLabel: finding.nodeId,
      },
      sourceLimit,
      compareById,
    );
  }
  return items.sort(compareById);
}

export function collectMaintenanceChanges(
  inspection: MaintenanceInspection,
  limit = RECENT_CHANGES_LIMIT,
): RecentChangeItem[] {
  const sourceLimit = normalizedLimit(limit);
  const items: RecentChangeItem[] = [];
  const add = (key: string, value: unknown) => {
    const title = text(value);
    if (title) pushBounded(items, toMaintenanceItem(key, title), sourceLimit, compareById);
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

  return items.sort(compareById);
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
  const drift = items.filter((item) => item.source === 'drift').sort(compareById);
  const dated = items
    .filter((item) => item.source !== 'drift' && Number.isFinite(Date.parse(item.time)))
    .sort(compareDatedNewest);
  const undated = items
    .filter((item) => item.source !== 'drift' && !Number.isFinite(Date.parse(item.time)))
    .sort(compareById);

  return [...drift, ...dated, ...undated].slice(0, limit);
}

export async function listRecentChanges(repoRoot: string): Promise<RecentChangeItem[]> {
  const [git, features, gates] = await Promise.all([
    collectGitChanges(repoRoot),
    collectFeatureChanges(repoRoot),
    listGates(),
  ]);
  const adrs = collectAdrChanges(repoRoot, RECENT_CHANGES_LIMIT);
  // Complete graph, maintenance, and live-ID reads preserve drift truth and verified links; only emitted items are capped.
  const drift = collectDriftChanges(buildKnowledgeGraph(repoRoot).drift, RECENT_CHANGES_LIMIT);
  const maintenance = collectMaintenanceChanges(inspectMaintenance(repoRoot), RECENT_CHANGES_LIMIT);
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
