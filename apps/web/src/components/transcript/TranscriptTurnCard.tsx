import { useId, useState } from 'react';
import { CodeBlock } from '@/components/code/CodeBlock';
import { MarkdownMessage } from '@/components/code/MarkdownMessage';
import { TranscriptBadge } from './TranscriptBadge';
import type { DenoiseResult } from '@/features/transcripts/transcript-denoise';
import {
  getToolDisplayLabel,
  getTurnRoleLabel,
  isToolOnlyTurn,
  type TranscriptTurnLike,
} from '@/features/transcripts/transcripts-model';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { formatDuration } from '@/components/timeline/timeline-utils';

// Fallback rule: plain bodies render fully until they exceed this length,
// then collapse behind an explicit expand control.
const PLAIN_PREVIEW_LIMIT = 1200;

const TOOL_KEYS = new Set([
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'LS',
  'MultiEdit',
  'Read',
  'TodoWrite',
  'WebFetch',
  'Write',
]);

interface TranscriptTurnCardProps {
  turn: TranscriptTurnLike;
  denoise: DenoiseResult;
  startTime: number | null;
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function TranscriptTurnCard({ turn, denoise, startTime }: TranscriptTurnCardProps) {
  const { t } = useI18n();
  const rawRegionId = useId();
  const [showRaw, setShowRaw] = useState(false);
  const [plainExpanded, setPlainExpanded] = useState(false);

  const toolOnly = isToolOnlyTurn(turn);
  const role = getTurnRoleLabel(turn);
  const timestamp = parseTimestamp(turn.timestamp);
  const offsetMs = startTime !== null && timestamp !== null ? timestamp - startTime : null;
  const hasRaw = Boolean(turn.text) && denoise.kind !== 'plain';
  const plainText = denoise.raw;
  const isLongPlain = denoise.kind === 'plain' && plainText.length > PLAIN_PREVIEW_LIMIT;

  function translateToolLabel(tool: string): string {
    return TOOL_KEYS.has(tool)
      ? t(`transcripts.tool.${tool}` as I18nKey)
      : getToolDisplayLabel(tool);
  }

  return (
    <div className={`card-hover p-4 ${toolOnly ? 'bg-slate-50/70 dark:bg-slate-900/30' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <TranscriptBadge role={role} toolOnly={toolOnly} />

        {denoise.kind === 'slashCommand' && denoise.chipParam && (
          <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
            {t('transcript.chip.slashCommand', { name: denoise.chipParam })}
          </span>
        )}
        {(denoise.kind === 'stdout' || denoise.secondaryChip === 'commandStdout') && (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {t('transcript.chip.commandStdout')}
          </span>
        )}
        {denoise.kind === 'taskNotification' && (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {t('transcript.chip.taskNotification')}
          </span>
        )}
        {denoise.kind === 'recap' && (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {t('transcript.chip.recap')}
          </span>
        )}
        {turn.tools?.map((tool) => (
          <span
            key={tool}
            className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          >
            {translateToolLabel(tool)}
          </span>
        ))}

        <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {offsetMs !== null && (
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400">
              +{formatDuration(offsetMs)}
            </span>
          )}
          {turn.timestamp && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {new Date(turn.timestamp).toLocaleString()}
            </span>
          )}
        </span>
      </div>

      {toolOnly && (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {t('transcripts.detail.assistantRequested', {
            tools: turn.tools.map(translateToolLabel).join(', '),
          })}
        </p>
      )}

      {denoise.kind !== 'plain' && denoise.summary && (
        <p
          className="mt-2 truncate text-sm text-slate-600 dark:text-slate-300"
          title={denoise.summary}
        >
          {denoise.summary}
        </p>
      )}

      {denoise.kind === 'plain' && !isLongPlain && plainText && (
        <div className="mt-2">
          <MarkdownMessage text={plainText} />
        </div>
      )}

      {isLongPlain && (
        <div className="mt-2">
          {plainExpanded ? (
            <>
              <MarkdownMessage text={plainText} />
              <button
                type="button"
                onClick={() => setPlainExpanded(false)}
                className="mt-2 rounded px-1 text-xs font-medium text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400"
              >
                {t('transcript.collapse')}
              </button>
            </>
          ) : (
            <>
              <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-300">
                {`${plainText.slice(0, PLAIN_PREVIEW_LIMIT)}…`}
              </div>
              <button
                type="button"
                onClick={() => setPlainExpanded(true)}
                className="mt-2 rounded px-1 text-xs font-medium text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400"
              >
                {t('transcript.expand')}
              </button>
            </>
          )}
        </div>
      )}

      {hasRaw && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRaw((current) => !current)}
            aria-expanded={showRaw}
            aria-controls={rawRegionId}
            className="rounded px-1 text-xs font-medium text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400"
          >
            {showRaw ? t('transcript.hideRaw') : t('transcript.viewRaw')}
          </button>
          {showRaw && (
            <div id={rawRegionId} className="mt-2">
              <CodeBlock code={denoise.raw} title="raw" collapseAfterLines={18} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
