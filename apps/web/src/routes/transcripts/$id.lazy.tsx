import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import { TranscriptTimeline } from '@/components/transcript/TranscriptTimeline';
import {
  buildTranscriptTimeline,
  type TranscriptTimelineModel,
} from '@/features/transcripts/transcript-timeline-model';
import type { TranscriptMetadataItem } from '@/features/transcripts/transcripts-model';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { trpc } from '@/lib/trpc';

export const Route = createLazyFileRoute('/transcripts/$id')({ component: TranscriptDetailPage });

const metadataKeyByLabel = {
  'Attachment record': 'attachment',
  'Empty assistant record': 'emptyAssistant',
  'Empty system record': 'emptySystem',
  'Empty user record': 'emptyUser',
  'File history snapshot': 'fileHistorySnapshot',
  'Local command record': 'localCommand',
  'Permission record': 'permissionMode',
  'Prompt snapshot': 'lastPrompt',
  'Queue operation record': 'queueOperation',
  'Session mode record': 'mode',
  'Summary record': 'summary',
  'System reminder record': 'systemReminder',
} as const;

type MetadataTranslationKey = (typeof metadataKeyByLabel)[keyof typeof metadataKeyByLabel];

// Denoise-hidden groups (R1/R6) live in the new `transcript.hidden.*`
// namespace; legacy metadata groups keep `transcripts.metadata.*`.
const DENOISE_METADATA_KEYS = new Set(['localCommand', 'systemReminder']);

type TranslateFn = (key: I18nKey, params?: Record<string, string | number>) => string;

function getMetadataTranslationKey(label: string): MetadataTranslationKey | undefined {
  return metadataKeyByLabel[label as keyof typeof metadataKeyByLabel];
}

function metadataKeyNamespace(
  metadataKey: MetadataTranslationKey,
): 'transcript.hidden' | 'transcripts.metadata' {
  return DENOISE_METADATA_KEYS.has(metadataKey) ? 'transcript.hidden' : 'transcripts.metadata';
}

function translateMetadataLabel(label: string, t: TranslateFn): string {
  const metadataKey = getMetadataTranslationKey(label);
  return metadataKey
    ? t(`${metadataKeyNamespace(metadataKey)}.${metadataKey}.label` as I18nKey)
    : label;
}

function translateMetadataDescription(group: MetadataGroup, t: TranslateFn): string {
  return group.metadataKey
    ? t(`${metadataKeyNamespace(group.metadataKey)}.${group.metadataKey}.description` as I18nKey)
    : group.description;
}

function formatMetadataSummary(metadata: TranscriptMetadataItem[], t: TranslateFn): string {
  const counts = metadata.reduce<Record<string, { count: number; item: TranscriptMetadataItem }>>(
    (acc, item) => {
      const key = getMetadataTranslationKey(item.label) ?? item.summaryLabel;
      acc[key] = { count: (acc[key]?.count ?? 0) + 1, item };
      return acc;
    },
    {},
  );

  return Object.values(counts)
    .map(({ count, item }) => {
      const metadataKey = getMetadataTranslationKey(item.label);
      const label = metadataKey
        ? t(
            `${metadataKeyNamespace(metadataKey)}.${metadataKey}.${count === 1 ? 'summaryOne' : 'summary'}` as I18nKey,
          )
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
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {t('transcripts.detail.hiddenSystemRecords')}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t(
              metadata.length === 1
                ? 'transcripts.detail.hiddenRecordsSummaryOne'
                : 'transcripts.detail.hiddenRecordsSummary',
              {
                count: metadata.length,
                summary: formatMetadataSummary(metadata, t),
              },
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls={metadataPanelId}
          className="self-start rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300 dark:hover:bg-slate-800 sm:self-auto"
        >
          {expanded
            ? t('transcripts.detail.hideRecordTypes')
            : t('transcripts.detail.showRecordTypes')}
        </button>
      </div>

      {expanded && (
        <div
          id={metadataPanelId}
          className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800"
        >
          {groups.map((group) => {
            const timestampRange = formatTimestampRange(group);

            return (
              <div
                key={group.metadataKey ?? group.label}
                className="flex flex-col gap-2 px-3 py-3 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-800 dark:text-slate-100">
                      {translateMetadataLabel(group.label, t)}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {t(
                        group.count === 1
                          ? 'transcripts.detail.recordsOne'
                          : 'transcripts.detail.records',
                        { count: group.count },
                      )}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                    {translateMetadataDescription(group, t)}
                  </p>
                </div>
                {timestampRange && (
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {timestampRange}
                  </span>
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
  const { data: detail, isLoading, error, refetch } = trpc.transcript.read.useQuery({ id });
  const saveDigest = trpc.transcript.save.useMutation();
  const proposeRegressions = trpc.transcript.proposeRegressions.useMutation();
  const timelineModel = useMemo<TranscriptTimelineModel>(
    () => buildTranscriptTimeline(detail?.turns ?? []),
    [detail?.turns],
  );

  return (
    <div className="page-container space-y-6">
      <header className="space-y-3">
        <Link
          to="/transcripts"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('transcripts.detail.back')}
        </Link>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="font-mono text-xl font-semibold text-slate-950 dark:text-white sm:text-2xl">
              {id.slice(0, 8)}
            </h1>
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
              {proposeRegressions.isLoading
                ? t('transcripts.detail.scanning')
                : t('transcripts.detail.proposeRegressions')}
            </button>
          </div>
        </div>

        {(saveDigest.isSuccess || saveDigest.isError || proposeRegressions.isSuccess) && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {saveDigest.isSuccess && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {t('transcripts.detail.savedToLens')}
              </span>
            )}
            {saveDigest.isError && (
              <span className="text-red-600 dark:text-red-400">
                {t('transcripts.detail.saveFailed')}
              </span>
            )}
            {proposeRegressions.isSuccess && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {t('transcripts.detail.proposalsWritten', {
                  count: proposeRegressions.data.proposedCount,
                })}
              </span>
            )}
          </div>
        )}
      </header>

      {isLoading && <div className="card h-24 animate-pulse p-5" />}

      {error && (
        <div className="card p-5">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {t('transcripts.detail.failedTitle')}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error.message}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/transcripts" className="btn-secondary text-sm">
              {t('transcripts.detail.back')}
            </Link>
            <button onClick={() => refetch()} className="btn-secondary text-sm">
              {t('common.retry')}
            </button>
          </div>
        </div>
      )}

      {detail && detail.turns.length >= 50 && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          {t(
            timelineModel.visibleTurns.length === 1
              ? 'transcripts.detail.visibleTurnsOne'
              : 'transcripts.detail.visibleTurns',
            { count: timelineModel.visibleTurns.length },
          )}
          {timelineModel.metadata.length > 0
            ? ` ${t(timelineModel.metadata.length === 1 ? 'transcripts.detail.hiddenSystemRecordsInlineOne' : 'transcripts.detail.hiddenSystemRecordsInline', { count: timelineModel.metadata.length })}`
            : ''}
        </div>
      )}

      {detail && (
        <>
          <MetadataPanel metadata={timelineModel.metadata} />
          <TranscriptTimeline model={timelineModel} />
        </>
      )}
    </div>
  );
}
