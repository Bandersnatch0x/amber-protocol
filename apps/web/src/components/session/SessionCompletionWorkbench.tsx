import { FormEvent, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { CommandCopyBlock } from '@/components/code/CommandCopyBlock';
import { localizeCompletionHint } from '@/features/backend-copy/backend-copy';

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

// ---------------------------------------------------------------------------
// Async verification job state machine (ADR-0007 amendment): runVerification
// now either denies synchronously or accepts a background job. All phase
// derivation is a pure function over (mutation state, submission, job query)
// so it stays unit-testable without React.
// ---------------------------------------------------------------------------

export type VerificationJobStatus =
  'pending' | 'running' | 'denied' | 'completed' | 'failed' | 'timeout';
export type VerificationPhase = 'idle' | 'submitting' | 'running' | 'settled';

export const TERMINAL_VERIFICATION_JOB_STATUSES: readonly VerificationJobStatus[] = [
  'denied',
  'completed',
  'failed',
  'timeout',
];

const KNOWN_VERIFICATION_JOB_STATUSES: readonly VerificationJobStatus[] = [
  'pending',
  'running',
  ...TERMINAL_VERIFICATION_JOB_STATUSES,
];

export function isTerminalVerificationJobStatus(value: unknown): value is VerificationJobStatus {
  return (
    typeof value === 'string' &&
    (TERMINAL_VERIFICATION_JOB_STATUSES as readonly string[]).includes(value)
  );
}

export function isKnownVerificationJobStatus(value: unknown): value is VerificationJobStatus {
  return (
    typeof value === 'string' &&
    (KNOWN_VERIFICATION_JOB_STATUSES as readonly string[]).includes(value)
  );
}

export type VerificationSubmission =
  { kind: 'denied'; result: UnknownRecord } | { kind: 'job'; jobId: string };

/** Parse the runVerification mutation result into the two contract shapes. */
export function resolveVerificationSubmission(submission: unknown): VerificationSubmission | null {
  if (!isRecord(submission)) return null;
  const status = typeof submission.status === 'string' ? submission.status.toLowerCase() : '';
  if (status === 'denied') return { kind: 'denied', result: submission };
  if (status === 'accepted' && typeof submission.jobId === 'string' && submission.jobId.trim()) {
    return { kind: 'job', jobId: submission.jobId.trim() };
  }
  return null;
}

export interface VerificationProgress {
  phase: VerificationPhase;
  jobId: string | null;
  jobStatus: VerificationJobStatus | null;
  /** Final result shape renderable by formatVerificationOutcome. */
  result: unknown;
  error: string | null;
}

/**
 * Derive the display state for async verification.
 *
 * - submitting: the mutation itself is in flight.
 * - running: an accepted job is pending/running (or its query has not landed
 *   yet) — SSE `evidence-job-changed` events plus a polling fallback drive the
 *   job query from the outside.
 * - settled: a synchronous denial or a terminal job; `result` holds the
 *   historical synchronous shape (denied / passed / failed) for rendering.
 */
export function resolveVerificationProgress(input: {
  isSubmitting: boolean;
  submission: unknown;
  job?: unknown;
}): VerificationProgress {
  const idle: VerificationProgress = {
    phase: 'idle',
    jobId: null,
    jobStatus: null,
    result: null,
    error: null,
  };

  if (input.isSubmitting) return { ...idle, phase: 'submitting' };

  const submission = resolveVerificationSubmission(input.submission);
  if (!submission) return idle;

  if (submission.kind === 'denied') {
    return {
      phase: 'settled',
      jobId: null,
      jobStatus: 'denied',
      result: submission.result,
      error: null,
    };
  }

  const job = isRecord(input.job) ? input.job : null;
  const jobStatus = job && isKnownVerificationJobStatus(job.status) ? job.status : null;

  if (!job || jobStatus === null || jobStatus === 'pending' || jobStatus === 'running') {
    return { phase: 'running', jobId: submission.jobId, jobStatus, result: null, error: null };
  }

  const jobError = typeof job.error === 'string' && job.error.trim() ? job.error.trim() : null;
  const result = isRecord(job.result)
    ? job.result
    : { status: jobStatus, ...(jobError ? { reason: jobError } : {}) };
  return {
    phase: 'settled',
    jobId: submission.jobId,
    jobStatus,
    result,
    error: jobStatus === 'completed' ? null : jobError,
  };
}

// ---------------------------------------------------------------------------
// Completion next-actions (continuity.completion.nextActions) normalization.
// ---------------------------------------------------------------------------

export type CompletionNextActionKind = 'in-page' | 'cli-command';

export interface CompletionNextAction {
  key: string;
  item: string;
  action: CompletionNextActionKind;
  command: string;
  hint: string;
}

export interface CompletionNextActionsView {
  status: 'pass' | 'fail' | 'unknown';
  actions: CompletionNextAction[];
}

/** Defensive normalization — unknown fields degrade instead of throwing. */
export function normalizeCompletionNextActions(value: unknown): CompletionNextActionsView {
  if (!isRecord(value)) return { status: 'unknown', actions: [] };

  const rawStatus = typeof value.status === 'string' ? value.status.toLowerCase() : '';
  const status = rawStatus === 'pass' ? 'pass' : rawStatus === 'fail' ? 'fail' : 'unknown';
  const rows = Array.isArray(value.actions) ? value.actions : [];

  const actions: CompletionNextAction[] = [];
  rows.forEach((row, index) => {
    if (!isRecord(row)) return;
    const item = firstString(row, ['item', 'label', 'id', 'name']) || `item-${index + 1}`;
    const action: CompletionNextActionKind = row.action === 'in-page' ? 'in-page' : 'cli-command';
    const command = typeof row.command === 'string' ? row.command.trim() : '';
    const hint = firstString(row, ['hint', 'message', 'detail', 'reason']);
    actions.push({ key: `${item}-${index}`, item, action, command, hint });
  });

  return { status, actions };
}

export function isInPageVerificationAction(action: CompletionNextAction): boolean {
  return action.action === 'in-page' && /verif/i.test(action.item);
}

export function isInPageApprovalAction(action: CompletionNextAction): boolean {
  return action.action === 'in-page' && /(approv|gate)/i.test(action.item);
}

interface SessionCompletionWorkbenchProps {
  completion: unknown;
  lifecycle?: unknown;
  isLoading?: boolean;
  error?: { message?: string } | null;
  isVerifying?: boolean;
  verificationError?: string | null;
  verificationResult?: unknown;
  /** Async verification state machine output (jobId + phase + settled result). */
  verificationProgress?: VerificationProgress | null;
  /** continuity.completion.nextActions raw payload (normalized defensively). */
  nextActions?: unknown;
  nextActionsLoading?: boolean;
  nextActionsError?: { message?: string } | null;
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
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  error:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
  neutral:
    'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
};

const checklistToneClasses: Record<LifecycleChecklistStatus, string> = {
  complete: 'bg-emerald-500',
  blocked: 'bg-red-500',
  current: 'bg-blue-500',
  pending: 'bg-slate-300 dark:bg-slate-600',
};

// ---------------------------------------------------------------------------
// Backend copy localization. The completion check emits raw English enums
// ("approval present", "verification", lifecycle step labels, the
// "Completion check status: ..." report). Known enums map onto the sessions
// i18n namespace; unknown strings degrade to the original text.
// ---------------------------------------------------------------------------

type TranslateFn = (key: I18nKey, params?: Record<string, string | number>) => string;

const backendValueKeyMap: Record<string, I18nKey> = {
  // completion-check missing items
  goal: 'sessions.completion.backend.missing.goal',
  timeline: 'sessions.completion.backend.missing.timeline',
  verification: 'sessions.completion.backend.missing.verification',
  approval: 'sessions.completion.backend.missing.approval',
  work: 'sessions.completion.backend.missing.work',
  handoff: 'sessions.completion.backend.missing.handoff',
  'open blockers': 'sessions.completion.backend.missing.openBlockers',
  'manifest not found': 'sessions.completion.backend.missing.manifestNotFound',
  'manifest is corrupt': 'sessions.completion.backend.missing.manifestCorrupt',
  // completion-check satisfied reasons
  'goal present': 'sessions.completion.backend.reason.goalPresent',
  'timeline present': 'sessions.completion.backend.reason.timelinePresent',
  'verification present': 'sessions.completion.backend.reason.verificationPresent',
  'approval present': 'sessions.completion.backend.reason.approvalPresent',
  'work present': 'sessions.completion.backend.reason.workPresent',
  'handoff present': 'sessions.completion.backend.reason.handoffPresent',
  'no open blockers': 'sessions.completion.backend.reason.noOpenBlockers',
  // lifecycle step labels (scripts/lib/core/lifecycle.js STEPS)
  'audit existing repository (read-only advisory)': 'sessions.completion.backend.step.audit',
  'install amber': 'sessions.completion.backend.step.init',
  'register a feature': 'sessions.completion.backend.step.feature',
  'create a plan': 'sessions.completion.backend.step.plan',
  'confirm the plan': 'sessions.completion.backend.step.gate',
  'record feature verification evidence': 'sessions.completion.backend.step.featureEvidence',
  'record session verification': 'sessions.completion.backend.step.verify',
  'approve the session': 'sessions.completion.backend.step.approve',
  'regenerate session handoff': 'sessions.completion.backend.step.handoff',
  'run completion check': 'sessions.completion.backend.step.completeCheck',
  'mark session completed': 'sessions.completion.backend.step.sessionComplete',
  'accept the plan': 'sessions.completion.backend.step.accept',
  'review learning write-back': 'sessions.completion.backend.step.learnings',
};

/** Localize a known backend enum string; unknown values degrade to the original. */
export function localizeBackendValue(value: string, t: TranslateFn): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const key = backendValueKeyMap[trimmed.toLowerCase()];
  return key ? t(key) : trimmed;
}

/**
 * Re-render the backend "Completion check status: ..." report from the
 * structured completion summary so it localizes end-to-end. Falls back to the
 * raw text whenever no structured data is available.
 */
export function localizeCompletionText(summary: CompletionSummary, t: TranslateFn): string {
  if (summary.missing.length === 0 && summary.reasons.length === 0) return summary.text;

  const statusLabel =
    summary.status === 'complete' ? 'pass' : summary.status === 'missing' ? 'fail' : summary.status;
  const lines: string[] = [t('sessions.completion.backend.text.status', { status: statusLabel })];
  lines.push(
    summary.reasons.length > 0
      ? `${t('sessions.completion.backend.text.reasons')}: ${summary.reasons.map((row) => localizeBackendValue(row, t)).join(', ')}`
      : `${t('sessions.completion.backend.text.reasons')}: ${t('sessions.completion.backend.text.none')}`,
  );
  if (summary.missing.length > 0) {
    lines.push(
      `${t('sessions.completion.backend.text.missing')}: ${summary.missing.map((row) => localizeBackendValue(row, t)).join(', ')}`,
    );
  }
  return lines.join('\n');
}

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

const APPROVAL_GAP_KEYWORD = /\b(approval|approve|gate|decision)\b/i;
// Negative phrasing only. The backend lists satisfied checks in `reasons`
// as affirmative sentences ("approval present"), so a bare keyword match
// would flag completed sessions as missing approval.
const APPROVAL_GAP_NEGATION =
  /\b(missing|absent|required|needed|pending|blocked|unresolved|lacking|awaiting|outstanding|no|none|not)\b/i;
const APPROVAL_GAP_AFFIRMATIVE =
  /\b(approval|approve|gate|decision)[\s-]*(present|granted|passed|recorded|logged|complete|completed|done|available)\b/i;

/**
 * Detect an approval gap from missing-semantics only: approval-family items
 * inside the `missing` list, or reasons that negate approval. Affirmative
 * reason sentences (e.g. "approval present") never count as a gap.
 */
export function includesApprovalGap(missing: string[], reasons: string[]): boolean {
  if (missing.some((row) => APPROVAL_GAP_KEYWORD.test(row))) return true;
  return reasons.some(
    (row) =>
      APPROVAL_GAP_KEYWORD.test(row) &&
      APPROVAL_GAP_NEGATION.test(row) &&
      !APPROVAL_GAP_AFFIRMATIVE.test(row),
  );
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
    approvalMissing: includesApprovalGap(missing, reasons),
  };
}

function normalizeChecklistStatus(
  value: unknown,
  done: unknown,
  current: unknown,
): LifecycleChecklistStatus {
  // The backend lifecycle DTO uses `done: boolean` (scripts/lib/core/lifecycle.js);
  // `complete` stays as a tolerated alias for older/alternate shapes.
  if (done === true) return 'complete';
  if (current === true) return 'current';

  const status = typeof value === 'string' ? value.toLowerCase() : '';
  if (/(complete|completed|ready|pass|passed|done)/.test(status)) return 'complete';
  if (/(block|blocked|fail|failed|error|rejected)/.test(status)) return 'blocked';
  if (/(current|active|running|executing|progress)/.test(status)) return 'current';
  return 'pending';
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'step'
  );
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

    const label =
      firstString(row, ['label', 'name', 'title', 'stage', 'id', 'key']) || `Step ${index + 1}`;
    const key = firstString(row, ['id', 'key', 'stage']) || slug(label);
    const detail = firstString(row, ['reason', 'detail', 'message', 'command', 'description']);
    items.push({
      key,
      label,
      // `done` is the canonical backend field; `complete` remains a tolerated alias.
      status: normalizeChecklistStatus(row.status, row.done ?? row.complete, row.current),
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
  appendOutcomeField(
    lines,
    'Status',
    firstString(result, ['outcome', 'status', 'text', 'message']) ||
      (result.success === true ? 'success' : ''),
  );
  appendOutcomeField(lines, 'Reason', result.reason);
  appendOutcomeField(lines, 'Exit code', result.exitCode);
  appendOutcomeField(lines, 'Stdout', result.stdoutTail);
  appendOutcomeField(lines, 'Stderr', result.stderrTail);
  return lines.join('\n');
}

function focusVerificationForm() {
  const field = document.getElementById('session-verification-command');
  if (!field) return;
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (field instanceof HTMLInputElement) field.focus({ preventScroll: true });
}

export function SessionCompletionWorkbench({
  completion,
  lifecycle,
  isLoading = false,
  error,
  isVerifying = false,
  verificationError,
  verificationResult,
  verificationProgress,
  nextActions,
  nextActionsLoading = false,
  nextActionsError,
  defaultCommand = '',
  onRunVerification,
}: SessionCompletionWorkbenchProps) {
  const { t } = useI18n();
  const [verificationCommand, setVerificationCommand] = useState(defaultCommand);
  // Secondary evidence detail (missing/reasons/lifecycle report) is collapsed
  // by default so the primary closing flow stays uncluttered.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const summary = buildCompletionSummary(completion);
  const checklist = normalizeLifecycleChecklist(
    lifecycle ?? (isRecord(completion) ? completion.lifecycle : undefined),
  );
  const verificationOutcome = formatVerificationOutcome(verificationResult);
  const nextActionsView = normalizeCompletionNextActions(nextActions);
  const closingAction = nextActionsView.status === 'pass' ? nextActionsView.actions[0] : undefined;
  const jobInProgress = Boolean(
    verificationProgress &&
    (verificationProgress.phase === 'submitting' || verificationProgress.phase === 'running'),
  );
  const completionReport = summary.text ? localizeCompletionText(summary, t) : '';

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
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('sessions.completion.strictState')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${completionToneClasses[summary.tone]}`}
          >
            {isLoading
              ? t('sessions.completion.loading')
              : t(completionStatusLabelKeys[summary.status])}
          </span>
          <button
            type="button"
            aria-expanded={detailsExpanded}
            aria-controls="session-completion-details"
            onClick={() => setDetailsExpanded((current) => !current)}
            className="rounded text-sm text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400"
          >
            {detailsExpanded
              ? t('sessions.completion.detailsHide')
              : t('sessions.completion.detailsShow')}
          </button>
        </div>
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
              <dd className="value">
                {summary.strict
                  ? t('sessions.completion.strict')
                  : t('sessions.completion.relaxed')}
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('sessions.completion.status')}</dt>
              <dd className="value">
                {isLoading
                  ? t('sessions.completion.loading')
                  : t(completionStatusLabelKeys[summary.status])}
              </dd>
            </div>
          </dl>

          {summary.approvalMissing && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <span className="font-medium">{t('sessions.completion.approvalMissing')}</span>
              <Link to="/gates" className="btn-secondary px-3 py-1.5 text-xs">
                {t('sessions.completion.openGates')}
              </Link>
            </div>
          )}

          <div>
            <h3 className="label">{t('sessions.completion.nextActions')}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('sessions.completion.nextActionsDetail')}
            </p>

            {nextActionsLoading && (
              <p className="mt-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('sessions.completion.nextActionsLoading')}
              </p>
            )}

            {!nextActionsLoading && nextActionsError && (
              <p className="mt-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('sessions.completion.nextActionsUnavailable')}
              </p>
            )}

            {!nextActionsLoading &&
              !nextActionsError &&
              nextActionsView.status === 'pass' &&
              closingAction && (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <p className="font-medium">{t('sessions.completion.closing.title')}</p>
                  <p className="mt-1 text-xs leading-5">
                    {t('sessions.completion.closing.detail')}
                  </p>
                  {closingAction.command && (
                    <CommandCopyBlock command={closingAction.command} className="mt-2" />
                  )}
                </div>
              )}

            {!nextActionsLoading &&
              !nextActionsError &&
              nextActionsView.status === 'fail' &&
              nextActionsView.actions.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {nextActionsView.actions.map((action) => (
                    <li
                      key={action.key}
                      className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-sm font-medium text-slate-900 dark:text-white">
                          {localizeBackendValue(action.item, t)}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {action.action === 'in-page'
                            ? t('sessions.completion.action.inPage')
                            : t('sessions.completion.action.cliCommand')}
                        </span>
                      </div>

                      {action.hint && (
                        <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                          {localizeCompletionHint(action.hint, t)}
                        </p>
                      )}

                      {isInPageVerificationAction(action) && (
                        <button
                          type="button"
                          onClick={focusVerificationForm}
                          className="btn-secondary mt-2 px-3 py-1.5 text-xs"
                        >
                          {t('sessions.completion.action.gotoVerify')}
                        </button>
                      )}

                      {isInPageApprovalAction(action) && (
                        <Link
                          to="/gates"
                          className="btn-secondary mt-2 inline-block px-3 py-1.5 text-xs"
                        >
                          {t('sessions.completion.openGates')}
                        </Link>
                      )}

                      {action.action === 'cli-command' && action.command && (
                        <CommandCopyBlock command={action.command} className="mt-2" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </div>

          {detailsExpanded && (
            <div
              id="session-completion-details"
              className="space-y-4 rounded-md border border-dashed border-slate-300 p-4 dark:border-slate-600"
            >
              <h3 className="label">{t('sessions.completion.detailsTitle')}</h3>

              <div>
                <h4 className="label">{t('sessions.completion.missingEvidence')}</h4>
                {summary.missing.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {summary.missing.map((item) => (
                      <li
                        key={item}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300"
                      >
                        {localizeBackendValue(item, t)}
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
                  <h4 className="label">{t('sessions.completion.reasons')}</h4>
                  <ul className="mt-2 space-y-2">
                    {summary.reasons.map((reason) => (
                      <li
                        key={reason}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300"
                      >
                        {localizeBackendValue(reason, t)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="label">{t('sessions.completion.lifecycle')}</h4>
                {checklist.length > 0 ? (
                  <ol className="mt-2 space-y-2">
                    {checklist.map((item) => (
                      <li
                        key={item.key}
                        className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${checklistToneClasses[item.status]}`}
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-sm font-medium text-slate-900 dark:text-white">
                                {localizeBackendValue(item.label, t)}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {t(checklistStatusLabelKeys[item.status])}
                              </span>
                            </div>
                            {item.detail && (
                              <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                                {item.detail}
                              </p>
                            )}
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

              {completionReport && (
                <div>
                  <h4 className="label">{t('sessions.completion.backendText')}</h4>
                  <p className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                    {completionReport}
                  </p>
                </div>
              )}
            </div>
          )}

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
              <button
                type="submit"
                className="btn-primary px-3 py-2 text-sm"
                disabled={isVerifying}
              >
                {isVerifying
                  ? t('sessions.completion.runningVerification')
                  : t('sessions.completion.runVerification')}
              </button>
            </div>
          </form>

          {jobInProgress && verificationProgress && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
              <p className="font-medium">
                {verificationProgress.jobStatus === 'pending'
                  ? t('sessions.completion.verificationJobQueued')
                  : t('sessions.completion.runningVerification')}
              </p>
              <p className="mt-1">{t('sessions.completion.verificationJobRunning')}</p>
              {verificationProgress.jobStatus && (
                <p className="mt-1 font-mono">
                  {t('sessions.completion.jobStatus')}: {verificationProgress.jobStatus}
                </p>
              )}
            </div>
          )}

          {verificationError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <p className="font-medium">{t('sessions.completion.verificationFailed')}</p>
              <p className="mt-1 break-words">{verificationError}</p>
            </div>
          )}

          {verificationOutcome && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
              <p className="font-medium">{t('sessions.completion.verificationOutcome')}</p>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono">
                {verificationOutcome}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
