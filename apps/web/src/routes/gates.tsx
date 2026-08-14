import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useEffect, useMemo, useState } from 'react';
import type { Gate, GateStatus } from '@/lib/types/gate';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { useSettings } from '@/lib/settings-provider';
import {
  buildApproveAndResumeFeedback,
  buildRejectFeedback,
  type GateActionFeedback,
} from '@/features/gates/gate-feedback';
import { AuditEvidenceCard } from '@/components/session/AuditEvidenceCard';

export const Route = createFileRoute('/gates')({ component: GatesPage });

const PAGE_SIZE = 100;

const statusOptions: { value: GateStatus | ''; labelKey: I18nKey }[] = [
  { value: '', labelKey: 'gates.filter.all' },
  { value: 'pending', labelKey: 'gates.filter.pending' },
  { value: 'approved', labelKey: 'gates.filter.approved' },
  { value: 'rejected', labelKey: 'gates.filter.rejected' },
];

const statusLabelKeys: Record<GateStatus, I18nKey> = {
  pending: 'gates.status.pending',
  approved: 'gates.status.approved',
  rejected: 'gates.status.rejected',
};

const statusStyles: Record<GateStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function getGateKey(gate: Pick<Gate, 'sessionId' | 'gateId'>): string {
  return `${gate.sessionId}:${gate.gateId}`;
}

function formatDateTime(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

function formatGateTime(status: GateStatus, triggeredAt: string, resolvedAt: string | undefined, t: (key: I18nKey) => string): { label: string; value: string } {
  if (status === 'pending') {
    return { label: t('gates.waitingSince'), value: formatDateTime(triggeredAt) };
  }
  return { label: t('gates.reviewedAt'), value: formatDateTime(resolvedAt ?? triggeredAt) };
}

function formatGateCount(count: number, t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  return t(count === 1 ? 'gates.countOne' : 'gates.count', { count: count.toLocaleString() });
}

function GateAuditEvidence({ gate }: { gate: Gate }) {
  const { t } = useI18n();
  const { data, isLoading, error } = trpc.gate.auditSummary.useQuery({
    sessionId: gate.sessionId,
    gateId: gate.gateId,
  });

  return (
    <AuditEvidenceCard
      summary={data}
      isLoading={isLoading}
      error={error}
      preferGateScoped
      compact
      labels={{
        loading: t('gates.audit.loading'),
        failed: t('gates.audit.failed'),
        title: t('gates.audit.title'),
        detail: t('gates.audit.detail'),
        ledgerMissing: t('gates.audit.ledgerMissing'),
        ledgerVerified: t('gates.audit.ledgerVerified'),
        ledgerBroken: t('gates.audit.ledgerBroken'),
        latestLedger: t('gates.audit.latestLedger'),
        emptyLedger: t('gates.audit.noGateLedger'),
        latestTimeline: t('gates.audit.latestTimeline'),
        emptyTimeline: t('gates.audit.noGateTimeline'),
        hash: t('gates.audit.hash'),
        counts: `${t('gates.audit.ledgerRecords')} / ${t('gates.audit.timelineEvents')}`,
        countValue: '{ledger} / {timeline}',
      }}
    />
  );
}

function GatesPage() {
  const { t } = useI18n();
  const { settings } = useSettings();
  const trpcUtils = trpc.useContext();
  const [statusFilter, setStatusFilter] = useState<GateStatus | ''>('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedGateKey, setExpandedGateKey] = useState<string | null>(null);
  const [rejectingGateKey, setRejectingGateKey] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [rejectInlineErrorKey, setRejectInlineErrorKey] = useState<string | null>(null);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<GateActionFeedback | null>(null);
  const { data: gates, isLoading, error, refetch } = trpc.gate.list.useQuery(statusFilter ? { status: statusFilter } : undefined);

  const approveAndResume = trpc.gate.approveAndResume.useMutation({
    onSuccess: async (result, variables) => {
      await Promise.all([
        refetch(),
        trpcUtils.gate.auditSummary.invalidate({ sessionId: variables.sessionId, gateId: variables.gateId }),
      ]);
      setRejectingGateKey(null);
      setRejectInlineErrorKey(null);
      setActionFeedback(buildApproveAndResumeFeedback(result, variables.gateId, t));
    },
    onError: (mutationError) => {
      setActionFeedback({ tone: 'error', message: t('gates.feedback.failed', { message: mutationError.message }) });
    },
    onSettled: () => {
      setPendingActionKey(null);
    },
  });

  const rejectGate = trpc.gate.reject.useMutation({
    onSuccess: async (result, variables) => {
      await Promise.all([
        refetch(),
        trpcUtils.gate.auditSummary.invalidate({ sessionId: variables.sessionId, gateId: variables.gateId }),
      ]);
      setRejectingGateKey(null);
      setRejectInlineErrorKey(null);
      setRejectReasons((current) => {
        const next = { ...current };
        delete next[getGateKey(variables)];
        return next;
      });
      setActionFeedback(buildRejectFeedback(result, variables.gateId, t));
    },
    onError: (mutationError) => {
      setActionFeedback({ tone: 'error', message: t('gates.feedback.failed', { message: mutationError.message }) });
    },
    onSettled: () => {
      setPendingActionKey(null);
    },
  });

  const orderedGates = useMemo(() => {
    if (!gates) return [];
    return [...gates].sort((left, right) => {
      const pendingDelta = Number(right.status === 'pending') - Number(left.status === 'pending');
      if (pendingDelta !== 0) return pendingDelta;
      return new Date(right.triggeredAt).getTime() - new Date(left.triggeredAt).getTime();
    });
  }, [gates]);
  const visibleGates = orderedGates.slice(0, visibleCount);
  const hasMoreGates = visibleGates.length < orderedGates.length;

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [statusFilter]);

  function handleReviewToggle(gate: Gate): void {
    const key = getGateKey(gate);
    setExpandedGateKey((current) => (current === key ? null : key));
  }

  function handleApproveAndRequestResume(gate: Gate): void {
    const key = getGateKey(gate);
    setPendingActionKey(key);
    setActionFeedback(null);
    approveAndResume.mutate({ sessionId: gate.sessionId, gateId: gate.gateId });
  }

  function handleReject(gate: Gate): void {
    const key = getGateKey(gate);
    const reason = rejectReasons[key]?.trim() ?? '';
    if (!reason) {
      setRejectInlineErrorKey(key);
      setActionFeedback({ tone: 'error', message: t('gates.feedback.rejectReasonRequired') });
      return;
    }

    setRejectInlineErrorKey(null);
    setPendingActionKey(key);
    setActionFeedback(null);
    rejectGate.mutate({ sessionId: gate.sessionId, gateId: gate.gateId, reason });
  }

  return (
    <div className="page-container space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">{t('gates.title')}</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">{t('gates.description')}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {isLoading ? t('gates.loading') : formatGateCount(orderedGates.length, t)}
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-[minmax(0,20rem)_1fr] md:items-start">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as GateStatus | '')}
            aria-label={t('gates.filterAria')}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
            ))}
          </select>
        </div>

        <div
          aria-live="polite"
          className={`rounded-lg border px-4 py-3 text-sm ${
            actionFeedback?.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
              : actionFeedback?.tone === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
                : actionFeedback?.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {actionFeedback?.message ?? t('gates.loopHint')}
        </div>
      </div>

      {isLoading && (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {[1, 2, 3].map((index) => (
            <div key={index} className="animate-pulse p-5">
              <div className="space-y-3">
                <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-5 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card p-5">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">{t('gates.failed')}</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error.message}</p>
          <button type="button" onClick={() => refetch()} className="btn-secondary mt-4 text-sm">{t('common.retry')}</button>
        </div>
      )}

      {!isLoading && !error && orderedGates.length === 0 && (
        <div className="card p-12 text-center">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {statusFilter ? t('gates.empty.filtered.title', { status: t(statusLabelKeys[statusFilter]) }) : t('gates.empty.all.title')}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {statusFilter ? t('gates.empty.filtered.detail') : t('gates.empty.all.detail')}
          </p>
        </div>
      )}

      {!isLoading && !error && orderedGates.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            {t('gates.showing', { visible: visibleGates.length.toLocaleString(), total: orderedGates.length.toLocaleString() })}
          </div>

          <div className="space-y-3">
            {visibleGates.map((gate) => {
              const key = getGateKey(gate);
              const gateTime = formatGateTime(gate.status, gate.triggeredAt, gate.resolvedAt, t);
              const isExpanded = expandedGateKey === key;
              const isRejecting = rejectingGateKey === key;
              const isPendingAction = pendingActionKey === key;
              const reviewPanelId = `gate-review-${gate.gateId}`;
              const rejectPanelId = `gate-reject-${gate.gateId}`;
              const rejectReasonId = `gate-reject-reason-${gate.gateId}`;
              const detailRows: { labelKey: I18nKey; value: string | undefined }[] = [
                { labelKey: 'gates.reviewPanel.sessionId', value: gate.sessionId },
                { labelKey: 'gates.reviewPanel.gateId', value: gate.gateId },
                { labelKey: 'gates.reviewPanel.type', value: gate.type },
                { labelKey: 'gates.reviewPanel.stage', value: gate.stage },
                { labelKey: 'gates.reviewPanel.triggeredAt', value: formatDateTime(gate.triggeredAt) },
                { labelKey: 'gates.reviewPanel.resolvedAt', value: gate.resolvedAt ? formatDateTime(gate.resolvedAt) : t('gates.reviewPanel.unresolved') },
                { labelKey: 'gates.reviewPanel.resolvedBy', value: gate.resolvedBy ?? t('gates.reviewPanel.unresolved') },
                { labelKey: 'gates.reviewPanel.reason', value: gate.reason || t('gates.reviewPanel.noReason') },
              ];

              return (
                <article key={key} className="card overflow-hidden">
                  <div className={settings.compactView ? 'px-4 py-3' : 'px-5 py-4'}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className={`min-w-0 flex-1 ${settings.compactView ? 'space-y-1' : 'space-y-2'}`}>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${statusStyles[gate.status]}`}>{t(statusLabelKeys[gate.status])}</span>
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{gate.gateId}</span>
                        </div>
                        <h2 className="text-sm font-medium text-slate-900 dark:text-white sm:text-base">{gate.description}</h2>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                          <span>{t('gates.stage', { stage: gate.stage })}</span>
                          <span>{t('gates.session', { session: gate.sessionId.slice(0, 8) })}</span>
                          <span>{gateTime.label} {gateTime.value}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={reviewPanelId}
                          onClick={() => handleReviewToggle(gate)}
                          className="btn-secondary px-3 py-1.5 text-xs"
                        >
                          {isExpanded ? t('gates.action.hideReview') : t('gates.action.review')}
                        </button>
                        {gate.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApproveAndRequestResume(gate)}
                              disabled={pendingActionKey !== null}
                              className="btn-primary px-3 py-1.5 text-xs"
                            >
                              {isPendingAction && approveAndResume.isLoading ? t('gates.action.requesting') : t('gates.action.approveAndRequestResume')}
                            </button>
                            <button
                              type="button"
                              aria-expanded={isRejecting}
                              aria-controls={rejectPanelId}
                              onClick={() => setRejectingGateKey((current) => (current === key ? null : key))}
                              disabled={pendingActionKey !== null}
                              className="btn-danger px-3 py-1.5 text-xs"
                            >
                              {t('gates.action.reject')}
                            </button>
                          </>
                        )}
                        <Link to="/sessions/$id" params={{ id: gate.sessionId }} search={{ from: 'gates' }} className="btn-secondary px-3 py-1.5 text-xs">
                          {t('gates.action.openSession')}
                        </Link>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div id={reviewPanelId} className="border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/50">
                      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
                        <div>
                          <h3 className="text-sm font-medium text-slate-900 dark:text-white">{t('gates.reviewPanel.title')}</h3>
                          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">{t('gates.reviewPanel.detail')}</p>
                          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                            {detailRows.map((row) => (
                              <div key={row.labelKey} className="min-w-0 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                                <dt className="label">{t(row.labelKey)}</dt>
                                <dd className="mt-1 break-words font-mono text-xs text-slate-900 dark:text-slate-100">{row.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                        <aside className="space-y-3">
                          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                            <p className="font-medium">{t('gates.reviewPanel.sourceTitle')}</p>
                            <p className="mt-1">{t('gates.reviewPanel.sourceDetail')}</p>
                            <code className="mt-3 block break-all rounded bg-white/70 p-2 font-mono text-[0.7rem] text-blue-950 dark:bg-slate-950/70 dark:text-blue-100">
                              .amber/sessions/{gate.sessionId}/gates/{gate.gateId}.gate.json
                            </code>
                          </div>
                          <GateAuditEvidence gate={gate} />
                        </aside>
                      </div>
                    </div>
                  )}

                  {isRejecting && gate.status === 'pending' && (
                    <div id={rejectPanelId} className="border-t border-red-200 bg-red-50 px-5 py-4 dark:border-red-900/60 dark:bg-red-950/20">
                      <label htmlFor={rejectReasonId} className="text-sm font-medium text-red-950 dark:text-red-100">
                        {t('gates.rejectReasonLabel')}
                      </label>
                      <p id={`${rejectReasonId}-hint`} className="mt-1 text-xs text-red-800 dark:text-red-200">
                        {t('gates.rejectReasonHint')}
                      </p>
                      <textarea
                        id={rejectReasonId}
                        aria-describedby={`${rejectReasonId}-hint`}
                        value={rejectReasons[key] ?? ''}
                        onChange={(event) => {
                          setRejectInlineErrorKey(null);
                          setRejectReasons((current) => ({ ...current, [key]: event.target.value }));
                        }}
                        rows={3}
                        className={`mt-3 w-full rounded-md bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:outline-none focus:ring-2 dark:bg-slate-950 dark:text-white ${
                          rejectInlineErrorKey === key
                            ? 'border-2 border-red-500 focus:ring-red-500'
                            : 'border border-red-200 focus:ring-red-500 dark:border-red-900/70'
                        }`}
                        placeholder={t('gates.rejectReasonPlaceholder')}
                      />
                      {rejectInlineErrorKey === key && (
                        <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                          {t('gates.feedback.rejectReasonRequiredInline')}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => { setRejectingGateKey(null); setRejectInlineErrorKey(null); }} disabled={pendingActionKey !== null}>
                          {t('gates.action.cancelReject')}
                        </button>
                        <button type="button" className="btn-danger px-3 py-1.5 text-xs" onClick={() => handleReject(gate)} disabled={pendingActionKey !== null}>
                          {isPendingAction && rejectGate.isLoading ? t('gates.action.rejecting') : t('gates.action.confirmReject')}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {hasMoreGates && (
            <button
              type="button"
              onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
              className="btn-secondary w-full justify-center text-sm"
            >
              {t('gates.showMore', { count: Math.min(PAGE_SIZE, orderedGates.length - visibleGates.length).toLocaleString() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
