import { FormEvent, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useI18n, type I18nKey } from '@/lib/i18n';

type UnknownRecord = Record<string, unknown>;

export type CompletionStatus = 'complete' | 'missing' | 'blocked' | 'unknown';
export type CompletionTone = 'success' | 'warning' | 'error' | 'neutral';
export type LifecycleChecklistStatus = 'complete' | 'blocked' | 'current' | 'pending';

export interface CompletionSummary {
  status: CompletionStatus;
  strict: boolean;
  tone: CompletionTone;
  reasons: string[];
  missing: string[];
  text: string;
  approvalMissing: boolean;
}

export interface LifecycleChecklistItem {
  key: string;
  label: string;
  status: LifecycleChecklistStatus;
  detail: string;
}

interface RunVerificationInput {
  command?: string;
}

interface SessionCompletionWorkbenchProps {
  completion: unknown;
  lifecycle?: unknown;
  isLoading?: boolean;
  error?: { message?: string } | null;
  isVerifying?: boolean;
  verificationError?: string | null;
  verificationResult?: unknown;
  defaultCommand?: string;
  onRunVerification: (input: RunVerificationInput) => Promise<void> | void;
}

const completionStatusLabelKeys: Record<CompletionStatus, I18nKey> = {
  complete: 'sessions.completion.status.complete',
  missing: 'sessions.completion.status.missing',
  blocked: 'sessions.completion.status.blocked',
  unknown: 'sessions.completion.status.unknown',
};

const checklistStatusLabelKeys: Record<LifecycleChecklistStatus, I18nKey> = {
  complete: 'sessions.completion.lifecycle.complete',
  blocked: 'sessions.completion.lifecycle.blocked',
  current: 'sessions.completion.lifecycle.current',
  pending: 'sessions.completion.lifecycle.pending',
};

const completionToneClasses: Record<CompletionTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
};

const checklistToneClasses: Record<LifecycleChecklistStatus, string> = {
  complete: 'bg-emerald-500',
  blocked: 'bg-red-500',
  current: 'bg-blue-500',
  pending: 'bg-slate-300 dark:bg-slate-600',
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function stringifyRow(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (!isRecord(value)) return '';

  const label = firstString(value, ['label', 'name', 'title', 'id', 'key', 'kind', 'type', 'path']);
  const detail = firstString(value, ['reason', 'detail', 'message', 'status', 'description']);
  if (label && detail && label !== detail) return `${label} - ${detail}`;
  return label || detail;
}

function toStringList(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return rows.map(stringifyRow).filter(Boolean);
}

function normalizeCompletionStatus(value: unknown, missing: string[] = []): CompletionStatus {
  const status = typeof value === 'string' ? value.toLowerCase() : '';
  if (/(complete|completed|ready|pass|passed|done)/.test(status)) return 'complete';
  if (/(missing|incomplete|pending|needs|required)/.test(status)) return 'missing';
  if (/(fail|failed)/.test(status)) return missing.length > 0 ? 'missing' : 'blocked';
  if (/(block|blocked|error|rejected)/.test(status)) return 'blocked';
  return 'unknown';
}

function completionTone(status: CompletionStatus): CompletionTone {
  if (status === 'complete') return 'success';
  if (status === 'blocked') return 'error';
  if (status === 'missing') return 'warning';
  return 'neutral';
}

function includesApprovalGap(rows: string[]): boolean {
  return rows.some((row) => /\b(approval|approve|gate|decision)\b/i.test(row));
}

export function buildCompletionSummary(completion: unknown): CompletionSummary {
  const record = isRecord(completion) ? completion : {};
  const reasons = toStringList(record.reasons);
  const missing = toStringList(record.missing);
  const status = normalizeCompletionStatus(record.status, missing);
  const text = firstString(record, ['text', 'summary', 'message']);

  return {
    status,
    strict: Boolean(record.strict),
    tone: completionTone(status),
    reasons,
    missing,
    text,
    approvalMissing: includesApprovalGap([...reasons, ...missing]),
  };
}

function normalizeChecklistStatus(value: unknown, complete: unknown, current: unknown): LifecycleChecklistStatus {
  if (complete === true) return 'complete';
  if (current === true) return 'current';

  const status = typeof value === 'string' ? value.toLowerCase() : '';
  if (/(complete|completed|ready|pass|passed|done)/.test(status)) return 'complete';
  if (/(block|blocked|fail|failed|error|rejected)/.test(status)) return 'blocked';
  if (/(current|active|running|executing|progress)/.test(status)) return 'current';
  return 'pending';
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
}

export function normalizeLifecycleChecklist(lifecycle: unknown): LifecycleChecklistItem[] {
  if (!Array.isArray(lifecycle)) return [];

  return lifecycle.reduce<LifecycleChecklistItem[]>((items, row, index) => {
    if (typeof row === 'string') {
      const label = row.trim();
      if (!label) return items;
      items.push({ key: slug(label), label, status: 'pending', detail: '' });
      return items;
    }

    if (!isRecord(row)) return items;

    const label = firstString(row, ['label', 'name', 'title', 'stage', 'id', 'key']) || `Step ${index + 1}`;
    const key = firstString(row, ['id', 'key', 'stage']) || slug(label);
    const detail = firstString(row, ['reason', 'detail', 'message', 'command', 'description']);
    items.push({
      key,
      label,
      status: normalizeChecklistStatus(row.status, row.complete, row.current),
      detail,
    });
    return items;
  }, []);
}

function stringifyScalar(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return '';
}

function appendOutcomeField(lines: string[], label: string, value: unknown): void {
  const text = stringifyScalar(value);
  if (!text) return;
  lines.push(text.includes('\n') ? `${label}:\n${text}` : `${label}: ${text}`);
}

export function formatVerificationOutcome(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (!isRecord(result)) return '';

  const lines: string[] = [];
  appendOutcomeField(lines, 'Status', firstString(result, ['outcome', 'status', 'text', 'message']) || (result.success === true ? 'success' : ''));
  appendOutcomeField(lines, 'Reason', result.reason);
  appendOutcomeField(lines, 'Exit code', result.exitCode);
  appendOutcomeField(lines, 'Stdout', result.stdoutTail);
  appendOutcomeField(lines, 'Stderr', result.stderrTail);
  return lines.join('\n');
}

export function SessionCompletionWorkbench({
  completion,
  lifecycle,
  isLoading = false,
  error,
  isVerifying = false,
  verificationError,
  verificationResult,
  defaultCommand = '',
  onRunVerification,
}: SessionCompletionWorkbenchProps) {
  const { t } = useI18n();
  const [verificationCommand, setVerificationCommand] = useState(defaultCommand);
  const summary = buildCompletionSummary(completion);
  const checklist = normalizeLifecycleChecklist(lifecycle ?? (isRecord(completion) ? completion.lifecycle : undefined));
  const verificationOutcome = formatVerificationOutcome(verificationResult);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = verificationCommand.trim();
    await onRunVerification({ command: command || undefined });
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{t('sessions.completion.title')}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('sessions.completion.strictState')}</p>
        </div>
        <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${completionToneClasses[summary.tone]}`}>
          {isLoading ? t('sessions.completion.loading') : t(completionStatusLabelKeys[summary.status])}
        </span>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-medium">{t('sessions.completion.unavailable')}</p>
          {error.message && <p className="mt-1 break-words">{error.message}</p>}
        </div>
      )}

      {!error && (
        <div className="mt-4 space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('sessions.completion.mode')}</dt>
              <dd className="value">{summary.strict ? t('sessions.completion.strict') : t('sessions.completion.relaxed')}</dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('sessions.completion.status')}</dt>
              <dd className="value">{isLoading ? t('sessions.completion.loading') : t(completionStatusLabelKeys[summary.status])}</dd>
            </div>
          </dl>

          {summary.text && (
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
              {summary.text}
            </p>
          )}

          {summary.approvalMissing && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <span className="font-medium">{t('sessions.completion.approvalMissing')}</span>
              <Link to="/gates" className="btn-secondary px-3 py-1.5 text-xs">
                {t('sessions.completion.openGates')}
              </Link>
            </div>
          )}

          <div>
            <h3 className="label">{t('sessions.completion.missingEvidence')}</h3>
            {summary.missing.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {summary.missing.map((item) => (
                  <li key={item} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('sessions.completion.noMissing')}
              </p>
            )}
          </div>

          {summary.reasons.length > 0 && (
            <div>
              <h3 className="label">{t('sessions.completion.reasons')}</h3>
              <ul className="mt-2 space-y-2">
                {summary.reasons.map((reason) => (
                  <li key={reason} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="label">{t('sessions.completion.lifecycle')}</h3>
            {checklist.length > 0 ? (
              <ol className="mt-2 space-y-2">
                {checklist.map((item) => (
                  <li key={item.key} className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${checklistToneClasses[item.status]}`} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{t(checklistStatusLabelKeys[item.status])}</span>
                        </div>
                        {item.detail && <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{item.detail}</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('sessions.completion.noLifecycle')}
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <label htmlFor="session-verification-command" className="label">
              {t('sessions.completion.verifyCommand')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="session-verification-command"
                value={verificationCommand}
                onChange={(event) => setVerificationCommand(event.target.value)}
                placeholder={t('sessions.completion.verifyPlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
              <button type="submit" className="btn-primary px-3 py-2 text-sm" disabled={isVerifying}>
                {isVerifying ? t('sessions.completion.runningVerification') : t('sessions.completion.runVerification')}
              </button>
            </div>
          </form>

          {verificationError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <p className="font-medium">{t('sessions.completion.verificationFailed')}</p>
              <p className="mt-1 break-words">{verificationError}</p>
            </div>
          )}

          {verificationOutcome && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
              <p className="font-medium">{t('sessions.completion.verificationOutcome')}</p>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono">{verificationOutcome}</pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
