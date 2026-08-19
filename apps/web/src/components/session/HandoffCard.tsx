import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { CommandCopyBlock } from '@/components/code/CommandCopyBlock';
import { CodeBlock } from '@/components/code/CodeBlock';

type UnknownRecord = Record<string, unknown>;

export type HandoffState = 'live' | 'scaffold' | 'missing';
export type HandoffPreviewSource = 'rendered' | 'session-handoff.md' | 'none';

export interface HandoffBundleView {
  present: boolean;
  valid: boolean;
  structureValid: boolean;
  deliveryReady: boolean;
  readinessScore: number | null;
  errors: string[];
}

export interface HandoffStatusView {
  state: HandoffState;
  sessionEvidence: boolean;
  bundle: HandoffBundleView;
}

const stateLabelKeys: Record<HandoffState, I18nKey> = {
  live: 'sessions.handoff.state.live',
  scaffold: 'sessions.handoff.state.scaffold',
  missing: 'sessions.handoff.state.missing',
};

const stateToneClasses: Record<HandoffState, string> = {
  live: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
  scaffold:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  missing:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
};

const previewSourceLabelKeys: Record<HandoffPreviewSource, I18nKey> = {
  rendered: 'sessions.handoff.previewSource.rendered',
  'session-handoff.md': 'sessions.handoff.previewSource.file',
  none: 'sessions.handoff.previewSource.none',
};

const DEFAULT_HANDOFF_COMMAND = 'amber handoff --target .';

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Defensive normalization of continuity.handoff.status — unknown or future
 * fields degrade to the empty/missing state instead of throwing, matching the
 * buildCompletionSummary pattern in SessionCompletionWorkbench.
 */
export function normalizeHandoffStatus(value: unknown): HandoffStatusView | null {
  if (!isRecord(value)) return null;

  const rawState = typeof value.state === 'string' ? value.state.toLowerCase() : '';
  const state: HandoffState =
    rawState === 'live' ? 'live' : rawState === 'scaffold' ? 'scaffold' : 'missing';

  const bundle = isRecord(value.bundle) ? value.bundle : {};
  const rawErrors = Array.isArray(bundle.errors) ? bundle.errors : [];
  const rawScore = bundle.readinessScore;

  return {
    state,
    sessionEvidence: value.sessionEvidence === true,
    bundle: {
      present: bundle.present === true,
      valid: bundle.valid === true,
      structureValid: bundle.structureValid === true,
      deliveryReady: bundle.deliveryReady === true,
      readinessScore: typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null,
      errors: rawErrors.filter((row): row is string => typeof row === 'string'),
    },
  };
}

/** A card only asks for a CLI remediation command when something is not ready. */
export function handoffNeedsCliAction(status: HandoffStatusView): boolean {
  return status.state !== 'live' || !status.bundle.deliveryReady;
}

/**
 * Resolve the CLI remediation command. continuity.completion.nextActions is
 * authoritative when it carries one; otherwise fall back to the canonical
 * `amber handoff --target .` regeneration command.
 */
export function resolveHandoffCommand(
  status: HandoffStatusView | null,
  nextActions: unknown,
): string | null {
  if (!status || !handoffNeedsCliAction(status)) return null;

  if (isRecord(nextActions) && Array.isArray(nextActions.actions)) {
    const rows = nextActions.actions.filter(isRecord);
    const handoffRow = rows.find(
      (row) =>
        typeof row.item === 'string' &&
        /handoff/i.test(row.item) &&
        typeof row.command === 'string' &&
        row.command.trim().length > 0,
    );
    if (handoffRow && typeof handoffRow.command === 'string') return handoffRow.command.trim();

    const anyRow = rows.find(
      (row) => typeof row.command === 'string' && row.command.trim().length > 0,
    );
    if (anyRow && typeof anyRow.command === 'string') return anyRow.command.trim();
  }

  return DEFAULT_HANDOFF_COMMAND;
}

interface HandoffCardProps {
  sessionId: string;
  className?: string;
}

/**
 * Read-only handoff continuity card (ADR-0007): shows live/scaffold/missing
 * state, bundle delivery readiness, a lazily-loaded markdown preview, and a
 * copy-only CLI remediation command. It never writes anything.
 */
export function HandoffCard({ sessionId, className = '' }: HandoffCardProps) {
  const { t } = useI18n();
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const statusQuery = trpc.continuity.handoff.status.useQuery({ sessionId });
  const status = normalizeHandoffStatus(statusQuery.data);
  const needsCli = status ? handoffNeedsCliAction(status) : false;

  // The CLI command comes from the completion next-actions contract; only ask
  // for it when the card actually needs remediation guidance.
  const nextActionsQuery = trpc.continuity.completion.nextActions.useQuery(
    { sessionId },
    { enabled: needsCli },
  );
  // Preview is lazy: the render-only fold runs server-side on demand, never on
  // first paint.
  const previewQuery = trpc.continuity.handoff.preview.useQuery(
    { sessionId },
    { enabled: previewExpanded },
  );

  if (statusQuery.isLoading) {
    return (
      <div
        className={`rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 ${className}`}
      >
        {t('sessions.handoff.loading')}
      </div>
    );
  }

  if (statusQuery.error || !status) {
    return (
      <div
        className={`rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200 ${className}`}
      >
        <p className="font-medium">{t('sessions.handoff.failed')}</p>
        {statusQuery.error && <p className="mt-1 break-words">{statusQuery.error.message}</p>}
      </div>
    );
  }

  const command = resolveHandoffCommand(status, nextActionsQuery.data);
  const bundle = status.bundle;
  const bundleLabel = !bundle.present
    ? t('sessions.handoff.bundle.missing')
    : !bundle.structureValid
      ? t('sessions.handoff.bundle.invalid')
      : bundle.deliveryReady
        ? t('sessions.handoff.bundle.deliveryReady')
        : t('sessions.handoff.bundle.notReady');
  const previewSource: HandoffPreviewSource =
    previewQuery.data &&
    typeof previewQuery.data.source === 'string' &&
    previewQuery.data.source in previewSourceLabelKeys
      ? (previewQuery.data.source as HandoffPreviewSource)
      : 'none';

  return (
    <div
      className={`rounded-md border p-3 text-xs leading-5 ${stateToneClasses[status.state]} ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t('sessions.handoff.title')}</p>
          <p className="mt-1">{t('sessions.handoff.detail')}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium dark:bg-slate-950/50">
          {t(stateLabelKeys[status.state])}
        </span>
      </div>

      <dl className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="font-medium">{t('sessions.handoff.bundle')}</dt>
          <dd className="font-medium">{bundleLabel}</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="font-medium">{t('sessions.handoff.readinessScore')}</dt>
          <dd>{bundle.readinessScore === null ? '-' : `${bundle.readinessScore}/100`}</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="font-medium">{t('sessions.handoff.sessionEvidence')}</dt>
          <dd>
            {status.sessionEvidence
              ? t('sessions.handoff.evidencePresent')
              : t('sessions.handoff.evidenceMissing')}
          </dd>
        </div>
      </dl>

      {bundle.errors.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">{t('sessions.handoff.errors')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {bundle.errors.slice(0, 5).map((error) => (
              <li key={error} className="break-words">
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <button
          type="button"
          aria-expanded={previewExpanded}
          onClick={() => setPreviewExpanded((current) => !current)}
          className="rounded text-xs font-medium text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400"
        >
          {previewExpanded ? t('sessions.handoff.previewHide') : t('sessions.handoff.preview')}
        </button>

        {previewExpanded && (
          <div className="mt-2">
            {previewQuery.isLoading && <p>{t('sessions.handoff.previewLoading')}</p>}
            {previewQuery.error && (
              <p className="break-words rounded bg-white/60 p-2 dark:bg-slate-950/40">
                {t('sessions.handoff.previewFailed')}: {previewQuery.error.message}
              </p>
            )}
            {!previewQuery.isLoading && !previewQuery.error && previewQuery.data && (
              <div className="space-y-2">
                <p className="text-[0.68rem] uppercase tracking-wide opacity-75">
                  {t(previewSourceLabelKeys[previewSource])}
                </p>
                {previewQuery.data.markdown ? (
                  <CodeBlock
                    code={previewQuery.data.markdown}
                    language="markdown"
                    title="session-handoff.md"
                  />
                ) : (
                  <p className="rounded bg-white/60 p-2 dark:bg-slate-950/40">
                    {t('sessions.handoff.previewEmpty')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {command && (
        <div className="mt-3">
          <p className="font-medium">{t('sessions.handoff.cli.title')}</p>
          <CommandCopyBlock
            command={command}
            hint={t('sessions.handoff.cli.detail')}
            className="mt-1"
          />
        </div>
      )}
    </div>
  );
}
