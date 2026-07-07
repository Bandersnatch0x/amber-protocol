import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import { MarkdownMessage } from '@/components/code/MarkdownMessage';
import {
  buildTranscriptDisplayModel,
  getToolDisplayLabel,
  getTurnDisplayLabel,
  getTurnRoleLabel,
  isToolOnlyTurn,
  type TranscriptMetadataItem,
  type TranscriptTurnLike,
} from '@/features/transcripts/transcripts-model';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { trpc } from '@/lib/trpc';

export const Route = createLazyFileRoute('/transcripts/$id')({ component: TranscriptDetailPage });

const TYPE_STYLES: Record<string, string> = {
  user: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  assistant: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  system: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  tool: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

const metadataKeyByLabel = {
  'Attachment record': 'attachment',
  'Empty assistant record': 'emptyAssistant',
  'Empty system record': 'emptySystem',
  'Empty user record': 'emptyUser',
  'File history snapshot': 'fileHistorySnapshot',
  'Permission record': 'permissionMode',
  'Prompt snapshot': 'lastPrompt',
  'Queue operation record': 'queueOperation',
  'Session mode record': 'mode',
  'Summary record': 'summary',
} as const;

type MetadataTranslationKey = (typeof metadataKeyByLabel)[keyof typeof metadataKeyByLabel];

const roleKeys = new Set(['assistant', 'system', 'tool', 'user']);
const typeKeys = new Set(['attachment', 'file-history-snapshot', 'last-prompt', 'mode', 'permission-mode', 'queue-operation', 'summary']);
const toolKeys = new Set(['Bash', 'Edit', 'Glob', 'Grep', 'LS', 'MultiEdit', 'Read', 'TodoWrite', 'WebFetch', 'Write']);

function getMetadataTranslationKey(label: string): MetadataTranslationKey | undefined {
  return metadataKeyByLabel[label as keyof typeof metadataKeyByLabel];
}

function translateMetadataLabel(label: string, t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  const metadataKey = getMetadataTranslationKey(label);
  return metadataKey ? t(`transcripts.metadata.${metadataKey}.label` as I18nKey) : label;
}

function translateMetadataDescription(group: MetadataGroup, t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  return group.metadataKey ? t(`transcripts.metadata.${group.metadataKey}.description` as I18nKey) : group.description;
}

function translateToolLabel(tool: string, t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  return toolKeys.has(tool) ? t(`transcripts.tool.${tool}` as I18nKey) : getToolDisplayLabel(tool);
}

function translateTurnLabel(turn: TranscriptTurnLike, t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  const roleLabel = getTurnRoleLabel(turn);
  if (roleKeys.has(roleLabel)) return t(`transcripts.role.${roleLabel}` as I18nKey);
  if (typeKeys.has(roleLabel)) return t(`transcripts.type.${roleLabel}` as I18nKey);
  return getTurnDisplayLabel(turn);
}

function formatMetadataSummary(metadata: TranscriptMetadataItem[], t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  const counts = metadata.reduce<Record<string, { count: number; item: TranscriptMetadataItem }>>((acc, item) => {
    const key = getMetadataTranslationKey(item.label) ?? item.summaryLabel;
    acc[key] = { count: (acc[key]?.count ?? 0) + 1, item };
    return acc;
  }, {});

  return Object.values(counts)
    .map(({ count, item }) => {
      const metadataKey = getMetadataTranslationKey(item.label);
      const label = metadataKey
        ? t(`transcripts.metadata.${metadataKey}.${count === 1 ? 'summaryOne' : 'summary'}` as I18nKey)
        : count === 1
          ? item.summaryLabel.replace(/s$/, '')
          : item.summaryLabel;
      return `${count} ${label}`;
    })
    .join(', ');
}

interface MetadataGroup {
  count: number;
  description: string;
  firstTimestamp?: string;
  label: string;
  lastTimestamp?: string;
  metadataKey?: MetadataTranslationKey;
}

function groupMetadata(metadata: TranscriptMetadataItem[]): MetadataGroup[] {
  const groups = new Map<string, MetadataGroup>();

  for (const item of metadata) {
    const metadataKey = getMetadataTranslationKey(item.label);
    const groupKey = metadataKey ?? item.label;
    const group = groups.get(groupKey) ?? {
      count: 0,
      description: item.description,
      label: item.label,
      metadataKey,
    };

    group.count += 1;

    if (item.timestamp) {
      if (!group.firstTimestamp || item.timestamp < group.firstTimestamp) {
        group.firstTimestamp = item.timestamp;
      }
      if (!group.lastTimestamp || item.timestamp > group.lastTimestamp) {
        group.lastTimestamp = item.timestamp;
      }
    }

    groups.set(groupKey, group);
  }

  return Array.from(groups.values());
}

function formatTimestampRange(group: MetadataGroup): string | null {
  if (!group.firstTimestamp) return null;

  const first = new Date(group.firstTimestamp).toLocaleString();
  if (!group.lastTimestamp || group.lastTimestamp === group.firstTimestamp) {
    return first;
  }

  return `${first} - ${new Date(group.lastTimestamp).toLocaleString()}`;
}

function MetadataPanel({ metadata }: { metadata: TranscriptMetadataItem[] }) {
  const { t } = useI18n();
  const metadataPanelId = useId();
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => groupMetadata(metadata), [metadata]);
  if (metadata.length === 0) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">{t('transcripts.detail.hiddenSystemRecords')}</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t(metadata.length === 1 ? 'transcripts.detail.hiddenRecordsSummaryOne' : 'transcripts.detail.hiddenRecordsSummary', {
              count: metadata.length,
              summary: formatMetadataSummary(metadata, t),
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls={metadataPanelId}
          className="self-start rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300 dark:hover:bg-slate-800 sm:self-auto"
        >
          {expanded ? t('transcripts.detail.hideRecordTypes') : t('transcripts.detail.showRecordTypes')}
        </button>
      </div>

      {expanded && (
        <div id={metadataPanelId} className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {groups.map((group) => {
            const timestampRange = formatTimestampRange(group);

            return (
              <div key={group.metadataKey ?? group.label} className="flex flex-col gap-2 px-3 py-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-800 dark:text-slate-100">{translateMetadataLabel(group.label, t)}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {t(group.count === 1 ? 'transcripts.detail.recordsOne' : 'transcripts.detail.records', { count: group.count })}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{translateMetadataDescription(group, t)}</p>
                </div>
                {timestampRange && (
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{timestampRange}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TranscriptDetailPage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const { data: detail, isLoading, error } = trpc.transcript.read.useQuery({ id });
  const saveDigest = trpc.transcript.save.useMutation();
  const proposeRegressions = trpc.transcript.proposeRegressions.useMutation();
  const displayModel = useMemo(
    () => buildTranscriptDisplayModel(detail?.turns ?? []),
    [detail?.turns],
  );

  return (
    <div className="page-container space-y-6">
      <header className="space-y-3">
        <Link to="/transcripts" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
          <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('transcripts.detail.back')}
        </Link>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="font-mono text-xl font-semibold text-slate-950 dark:text-white sm:text-2xl">{id.slice(0, 8)}</h1>
            {detail && (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {t('transcripts.detail.secretsRedacted', { count: detail.turnCount })}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => saveDigest.mutate({ id })}
              disabled={saveDigest.isLoading}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              {saveDigest.isLoading ? t('common.saving') : t('transcripts.detail.saveDigest')}
            </button>
            <button
              type="button"
              onClick={() => proposeRegressions.mutate({ id })}
              disabled={proposeRegressions.isLoading}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              {proposeRegressions.isLoading ? t('transcripts.detail.scanning') : t('transcripts.detail.proposeRegressions')}
            </button>
          </div>
        </div>

        {(saveDigest.isSuccess || saveDigest.isError || proposeRegressions.isSuccess) && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {saveDigest.isSuccess && <span className="text-emerald-600 dark:text-emerald-400">{t('transcripts.detail.savedToLens')}</span>}
            {saveDigest.isError && <span className="text-red-600 dark:text-red-400">{t('transcripts.detail.saveFailed')}</span>}
            {proposeRegressions.isSuccess && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {t('transcripts.detail.proposalsWritten', { count: proposeRegressions.data.proposedCount })}
              </span>
            )}
          </div>
        )}
      </header>

      {isLoading && <div className="card h-24 animate-pulse p-5" />}

      {error && (
        <div className="card p-5">
          <p className="text-sm text-slate-600 dark:text-slate-400">{error.message}</p>
        </div>
      )}

      {detail && detail.turns.length >= 50 && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          {t(displayModel.visibleTurns.length === 1 ? 'transcripts.detail.visibleTurnsOne' : 'transcripts.detail.visibleTurns', { count: displayModel.visibleTurns.length })}
          {displayModel.metadata.length > 0
            ? ` ${t(displayModel.metadata.length === 1 ? 'transcripts.detail.hiddenSystemRecordsInlineOne' : 'transcripts.detail.hiddenSystemRecordsInline', { count: displayModel.metadata.length })}`
            : ''}
        </div>
      )}

      {detail && (
        <>
          <MetadataPanel metadata={displayModel.metadata} />

          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
            {displayModel.visibleTurns.map((turn, index) => {
              const roleLabel = getTurnRoleLabel(turn);
              const toolOnly = isToolOnlyTurn(turn);

              return (
                <article key={`${turn.timestamp ?? 'turn'}-${index}`} className={toolOnly ? 'bg-slate-50/70 px-5 py-3 dark:bg-slate-900/30' : 'px-5 py-4'}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[roleLabel] ?? TYPE_STYLES.system}`}>
                      {toolOnly ? t('transcripts.detail.toolCall') : translateTurnLabel(turn, t)}
                    </span>
                    {turn.tools.map((tool) => (
                      <span key={tool} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {translateToolLabel(tool, t)}
                      </span>
                    ))}
                    {turn.timestamp && (
                      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                        {new Date(turn.timestamp).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {toolOnly && (
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      {t('transcripts.detail.assistantRequested', { tools: turn.tools.map((tool) => translateToolLabel(tool, t)).join(', ') })}
                    </p>
                  )}
                  {turn.text && <MarkdownMessage text={turn.text} />}
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
