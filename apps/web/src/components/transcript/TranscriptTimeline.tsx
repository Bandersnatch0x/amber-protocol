import { useMemo } from 'react';
import { TranscriptTurnCard } from './TranscriptTurnCard';
import type {
  TranscriptTimelineEntry,
  TranscriptTimelineModel,
} from '@/features/transcripts/transcript-timeline-model';
import { getTurnRoleLabel } from '@/features/transcripts/transcripts-model';
import { useI18n } from '@/lib/i18n';

// Axis dot palette mirrors the badge roles: user blue, assistant emerald,
// system/folded noise neutral slate.
const ROLE_DOT_STYLES: Record<string, string> = {
  user: 'bg-blue-500',
  assistant: 'bg-emerald-500',
  system: 'bg-slate-400',
};

const FALLBACK_DOT_STYLE = 'bg-slate-300 dark:bg-slate-600';

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

interface TranscriptTimelineProps {
  model: TranscriptTimelineModel;
}

export function TranscriptTimeline({ model }: TranscriptTimelineProps) {
  const startTime = useMemo(() => {
    for (const entry of model.entries) {
      if (entry.entryKind !== 'turn') continue;
      const parsed = parseTimestamp(entry.turn.timestamp);
      if (parsed !== null) return parsed;
    }
    return null;
  }, [model.entries]);

  if (model.entries.length === 0) {
    return null;
  }

  return (
    <div data-testid="transcript-timeline">
      {model.entries.map((entry) =>
        entry.entryKind === 'turnSeparator' ? (
          <TurnSeparatorRow key={entry.key} entry={entry} />
        ) : (
          <div key={entry.key} className="group flex gap-4">
            {/* Left axis: role dot + connector line, matching TimelineEvent */}
            <div className="relative flex flex-col items-center">
              <span
                className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                  ROLE_DOT_STYLES[getTurnRoleLabel(entry.turn)] ?? FALLBACK_DOT_STYLE
                }`}
              />
              <div className="mt-2 w-px flex-1 bg-slate-200 dark:bg-slate-700 group-last:hidden" />
            </div>

            <div className="min-w-0 flex-1 pb-6">
              <TranscriptTurnCard turn={entry.turn} denoise={entry.denoise} startTime={startTime} />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function TurnSeparatorRow({
  entry,
}: {
  entry: Extract<TranscriptTimelineEntry, { entryKind: 'turnSeparator' }>;
}) {
  const { t } = useI18n();
  const label = entry.timestamp
    ? `${t('transcript.turnSeparator')} · ${new Date(entry.timestamp).toLocaleString()}`
    : t('transcript.turnSeparator');

  return (
    <div data-testid="transcript-turn-separator" className="flex items-center gap-3 py-2 pl-7">
      <div className="h-px flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
      <span className="whitespace-nowrap text-xs font-medium text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <div className="h-px flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
    </div>
  );
}
