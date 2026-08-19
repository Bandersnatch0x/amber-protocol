import { useState } from 'react';
import { ConfirmAbortDialog } from './ConfirmAbortDialog';
import { trpc } from '@/lib/trpc';
import { useI18n } from '@/lib/i18n';
import type { SessionStatus } from '@/lib/types/session-events';

interface SessionControlsProps {
  sessionId: string;
  status: SessionStatus | null;
  onActionSettled?: () => void | Promise<void>;
}

interface ActionButton {
  key: 'start' | 'pause' | 'resume' | 'abort';
  label: string;
  pendingLabel: string;
  ariaLabel: string;
  className: string;
  onClick: () => void;
  isPending: boolean;
}

type RunnerAckStatus = 'acked' | 'rejected' | 'timeout';

interface ControlActionResult {
  persisted?: boolean;
  confirmed?: boolean;
  auditWarning?: string;
  runnerAck?: {
    status: RunnerAckStatus;
    requestId?: string;
    source?: string;
    message?: string;
  };
  confirmation?: {
    requestPersisted?: boolean;
    manifestConfirmed?: boolean;
    runnerAckStatus?: RunnerAckStatus;
  };
}

interface ConfirmationState {
  requestPersisted: boolean;
  manifestConfirmed: boolean;
  runnerAckStatus: RunnerAckStatus;
  requestId?: string;
  source?: string;
  message?: string;
}

function getConfirmationState(
  result: ControlActionResult | null | undefined,
): ConfirmationState | null {
  if (!result) return null;
  if (
    !result.confirmation &&
    !result.runnerAck &&
    result.persisted === undefined &&
    result.confirmed === undefined
  ) {
    return null;
  }

  return {
    requestPersisted: result.confirmation?.requestPersisted ?? Boolean(result.persisted),
    manifestConfirmed: result.confirmation?.manifestConfirmed ?? Boolean(result.confirmed),
    runnerAckStatus: result.confirmation?.runnerAckStatus ?? result.runnerAck?.status ?? 'timeout',
    requestId: result.runnerAck?.requestId,
    source: result.runnerAck?.source,
    message: result.runnerAck?.message,
  };
}

export function SessionControls({ sessionId, status, onActionSettled }: SessionControlsProps) {
  const { t } = useI18n();
  const [showAbortDialog, setShowAbortDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | null>(null);

  const startMutation = trpc.sessionControl.start.useMutation();
  const pauseMutation = trpc.sessionControl.pause.useMutation();
  const resumeMutation = trpc.sessionControl.resume.useMutation();
  const abortMutation = trpc.sessionControl.abort.useMutation();

  const isPending =
    startMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    abortMutation.isPending;

  const execute = async (mutation: typeof startMutation, action: string) => {
    setError(null);
    setWarning(null);
    setConfirmationState(null);
    try {
      const result = (await mutation.mutateAsync({ sessionId })) as ControlActionResult | undefined;
      if (result?.auditWarning) {
        setWarning(t('sessions.controls.auditWarning', { warning: result.auditWarning }));
      }
      setConfirmationState(getConfirmationState(result));
      await onActionSettled?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('sessions.controls.failedAction', { action }),
      );
    }
  };

  const actions: ActionButton[] = [];
  const isRunningLike = status === 'running' || status === 'executing';

  if (status === 'idle' || status === 'created' || status === 'routed') {
    actions.push({
      key: 'start',
      label: t('sessions.controls.start'),
      pendingLabel: t('sessions.controls.starting'),
      ariaLabel: t('sessions.controls.startAria'),
      className: 'btn-primary text-xs px-3 py-1.5',
      onClick: () => execute(startMutation, t('sessions.controls.start')),
      isPending: startMutation.isPending,
    });
  }

  if (isRunningLike) {
    actions.push({
      key: 'pause',
      label: t('sessions.controls.pause'),
      pendingLabel: t('sessions.controls.pausing'),
      ariaLabel: t('sessions.controls.pauseAria'),
      className: 'btn-secondary text-xs px-3 py-1.5',
      onClick: () => execute(pauseMutation, t('sessions.controls.pause')),
      isPending: pauseMutation.isPending,
    });
    actions.push({
      key: 'abort',
      label: t('sessions.controls.abort'),
      pendingLabel: t('sessions.controls.aborting'),
      ariaLabel: t('sessions.controls.abortAria'),
      className: 'btn-danger text-xs px-3 py-1.5',
      onClick: () => setShowAbortDialog(true),
      isPending: abortMutation.isPending,
    });
  }

  if (status === 'paused') {
    actions.push({
      key: 'resume',
      label: t('sessions.controls.resume'),
      pendingLabel: t('sessions.controls.resuming'),
      ariaLabel: t('sessions.controls.resumeAria'),
      className: 'btn-secondary text-xs px-3 py-1.5',
      onClick: () => execute(resumeMutation, t('sessions.controls.resume')),
      isPending: resumeMutation.isPending,
    });
    actions.push({
      key: 'abort',
      label: t('sessions.controls.abort'),
      pendingLabel: t('sessions.controls.aborting'),
      ariaLabel: t('sessions.controls.abortAria'),
      className: 'btn-danger text-xs px-3 py-1.5',
      onClick: () => setShowAbortDialog(true),
      isPending: abortMutation.isPending,
    });
  }

  if (actions.length === 0 && !error && !warning && !confirmationState && !showAbortDialog) {
    return null;
  }

  const runnerAckLabelKey =
    confirmationState?.runnerAckStatus === 'acked'
      ? 'sessions.controls.confirmation.runnerAcked'
      : confirmationState?.runnerAckStatus === 'rejected'
        ? 'sessions.controls.confirmation.runnerRejected'
        : 'sessions.controls.confirmation.runnerTimeout';
  const runnerAckTone =
    confirmationState?.runnerAckStatus === 'acked'
      ? 'text-emerald-700 dark:text-emerald-300'
      : confirmationState?.runnerAckStatus === 'rejected'
        ? 'text-red-700 dark:text-red-300'
        : 'text-amber-700 dark:text-amber-300';

  return (
    <div className="flex flex-col gap-2">
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-end">
          {actions.map((action) => (
            <button
              key={action.key}
              onClick={action.onClick}
              disabled={isPending}
              className={action.className}
              aria-label={action.ariaLabel}
            >
              {action.isPending ? action.pendingLabel : action.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline text-xs">
            {t('common.dismiss')}
          </button>
        </div>
      )}

      {warning && (
        <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
          <span>{warning}</span>
          <button onClick={() => setWarning(null)} className="underline text-xs">
            {t('common.dismiss')}
          </button>
        </div>
      )}

      {confirmationState && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
          <ol className="grid gap-1 sm:grid-cols-3">
            <li
              className={
                confirmationState.requestPersisted
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300'
              }
            >
              {confirmationState.requestPersisted
                ? t('sessions.controls.confirmation.requestPersisted')
                : t('sessions.controls.confirmation.requestNotPersisted')}
            </li>
            <li
              className={
                confirmationState.manifestConfirmed
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300'
              }
            >
              {confirmationState.manifestConfirmed
                ? t('sessions.controls.confirmation.manifestConfirmed')
                : t('sessions.controls.confirmation.manifestUnconfirmed')}
            </li>
            <li className={runnerAckTone}>{t(runnerAckLabelKey)}</li>
          </ol>
          {(confirmationState.message ||
            confirmationState.requestId ||
            confirmationState.source) && (
            <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 break-words font-mono text-[0.68rem] text-slate-500 dark:text-slate-400">
              {confirmationState.message && <span>{confirmationState.message}</span>}
              {confirmationState.requestId && <span>{confirmationState.requestId}</span>}
              {confirmationState.source && <span>{confirmationState.source}</span>}
            </p>
          )}
        </div>
      )}

      <ConfirmAbortDialog
        isOpen={showAbortDialog}
        onConfirm={() => {
          setShowAbortDialog(false);
          execute(abortMutation, t('sessions.controls.abort'));
        }}
        onCancel={() => setShowAbortDialog(false)}
      />
    </div>
  );
}
