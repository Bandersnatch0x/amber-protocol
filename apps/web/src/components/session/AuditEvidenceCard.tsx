export interface AuditRecordSummary {
  kind: string;
  gateId?: string;
  recordedAt?: string;
  hash?: string;
}

export interface AuditEventSummary {
  type: string;
  gateId?: string;
  timestamp?: string;
}

export interface AuditSummaryView {
  ledger: {
    path: string;
    exists: boolean;
    verified: boolean;
    recordCount: number;
    latest?: AuditRecordSummary;
    latestForGate?: AuditRecordSummary;
    error?: string;
  };
  timeline: {
    path: string;
    exists: boolean;
    eventCount: number;
    latest?: AuditEventSummary;
    latestForGate?: AuditEventSummary;
    error?: string;
  };
}

interface AuditEvidenceLabels {
  loading: string;
  failed: string;
  title: string;
  detail: string;
  /** Optional one-sentence plain-language gloss for the ledger term (task #27). */
  ledgerGloss?: string;
  ledgerMissing: string;
  ledgerVerified: string;
  ledgerBroken: string;
  latestLedger: string;
  emptyLedger: string;
  latestTimeline: string;
  emptyTimeline: string;
  hash: string;
  counts: string;
  countValue: string;
}

interface AuditEvidenceCardProps {
  summary: AuditSummaryView | undefined;
  isLoading: boolean;
  error?: { message: string } | null;
  labels: AuditEvidenceLabels;
  preferGateScoped?: boolean;
  className?: string;
  compact?: boolean;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatHash(value: string | undefined): string {
  if (!value) return '-';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function formatAuditRecord(record: AuditRecordSummary | undefined, emptyLabel: string): string {
  if (!record) return emptyLabel;
  return `${record.kind} - ${formatDateTime(record.recordedAt)}`;
}

function formatAuditEvent(event: AuditEventSummary | undefined, emptyLabel: string): string {
  if (!event) return emptyLabel;
  return `${event.type} - ${formatDateTime(event.timestamp)}`;
}

export function AuditEvidenceCard({
  summary,
  isLoading,
  error,
  labels,
  preferGateScoped = false,
  className = '',
  compact = false,
}: AuditEvidenceCardProps) {
  if (isLoading) {
    return (
      <div
        className={`rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 ${className}`}
      >
        {labels.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200 ${className}`}
      >
        <p className="font-medium">{labels.failed}</p>
        <p className="mt-1 break-words">{error.message}</p>
      </div>
    );
  }

  if (!summary) return null;

  const ledgerStatus = !summary.ledger.exists
    ? labels.ledgerMissing
    : summary.ledger.verified
      ? labels.ledgerVerified
      : labels.ledgerBroken;
  const ledgerTone =
    summary.ledger.exists && summary.ledger.verified
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
      : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200';
  const latestLedger = preferGateScoped ? summary.ledger.latestForGate : summary.ledger.latest;
  const latestTimeline = preferGateScoped
    ? summary.timeline.latestForGate
    : summary.timeline.latest;
  const hashSource = latestLedger ?? summary.ledger.latest;
  const textSize = compact ? 'text-xs leading-5' : 'text-sm leading-6';
  const definitionLayout = compact ? 'mt-3 space-y-2' : 'mt-3 grid gap-3 sm:grid-cols-2';

  return (
    <div className={`rounded-md border p-3 ${textSize} ${ledgerTone} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{labels.title}</p>
          <p className="mt-1 text-xs leading-5">{labels.detail}</p>
          {labels.ledgerGloss && (
            <p className="mt-1 text-xs leading-5 opacity-80">{labels.ledgerGloss}</p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium dark:bg-slate-950/50">
          {ledgerStatus}
        </span>
      </div>

      <dl className={definitionLayout}>
        <div>
          <dt className="text-xs font-medium">{labels.latestLedger}</dt>
          <dd className="break-words font-mono text-xs">
            {formatAuditRecord(latestLedger, labels.emptyLedger)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium">{labels.latestTimeline}</dt>
          <dd className="break-words font-mono text-xs">
            {formatAuditEvent(latestTimeline, labels.emptyTimeline)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium">{labels.hash}</dt>
          <dd className="font-mono text-xs">{formatHash(hashSource?.hash)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium">{labels.counts}</dt>
          <dd className="text-xs">
            {labels.countValue
              .replace('{ledger}', summary.ledger.recordCount.toLocaleString())
              .replace('{timeline}', summary.timeline.eventCount.toLocaleString())}
          </dd>
        </div>
      </dl>

      {(summary.ledger.error || summary.timeline.error) && (
        <p className="mt-3 break-words rounded bg-white/60 p-2 text-xs dark:bg-slate-950/40">
          {summary.ledger.error ?? summary.timeline.error}
        </p>
      )}

      <div className="mt-3 space-y-1 font-mono text-[0.68rem]">
        <code className="block break-all rounded bg-white/60 p-2 dark:bg-slate-950/40">
          {summary.ledger.path}
        </code>
        <code className="block break-all rounded bg-white/60 p-2 dark:bg-slate-950/40">
          {summary.timeline.path}
        </code>
      </div>
    </div>
  );
}
