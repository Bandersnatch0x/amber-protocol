import { useState } from 'react';
import { ConfirmAbortDialog } from './ConfirmAbortDialog';
import { trpc } from '@/lib/trpc';
import type { SessionStatus } from '@/lib/types/session-events';

interface SessionControlsProps {
  sessionId: string;
  status: SessionStatus | null;
}

export function SessionControls({ sessionId, status }: SessionControlsProps) {
  const [showAbortDialog, setShowAbortDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startMutation = trpc.sessionControl.start.useMutation();
  const pauseMutation = trpc.sessionControl.pause.useMutation();
  const resumeMutation = trpc.sessionControl.resume.useMutation();
  const abortMutation = trpc.sessionControl.abort.useMutation();

  const isPending = startMutation.isPending || pauseMutation.isPending || resumeMutation.isPending || abortMutation.isPending;

  const execute = async (mutation: typeof startMutation, action: string) => {
    setError(null);
    try {
      await mutation.mutateAsync({ sessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    }
  };

  const canStart = status === 'idle' && !isPending;
  const canPause = status === 'running' && !isPending;
  const canResume = status === 'paused' && !isPending;
  const canAbort = (status === 'running' || status === 'paused') && !isPending;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => execute(startMutation, 'start')}
          disabled={!canStart}
          className="btn-primary text-xs px-3 py-1.5"
          aria-label="Start session"
        >
          {startMutation.isPending ? 'Starting...' : 'Start'}
        </button>

        <button
          onClick={() => execute(pauseMutation, 'pause')}
          disabled={!canPause}
          className="btn-secondary text-xs px-3 py-1.5"
          aria-label="Pause session"
        >
          {pauseMutation.isPending ? 'Pausing...' : 'Pause'}
        </button>

        <button
          onClick={() => execute(resumeMutation, 'resume')}
          disabled={!canResume}
          className="btn-secondary text-xs px-3 py-1.5"
          aria-label="Resume session"
        >
          {resumeMutation.isPending ? 'Resuming...' : 'Resume'}
        </button>

        <button
          onClick={() => setShowAbortDialog(true)}
          disabled={!canAbort}
          className="btn-danger text-xs px-3 py-1.5"
          aria-label="Abort session"
        >
          {abortMutation.isPending ? 'Aborting...' : 'Abort'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline text-xs">Dismiss</button>
        </div>
      )}

      <ConfirmAbortDialog
        isOpen={showAbortDialog}
        onConfirm={() => {
          setShowAbortDialog(false);
          execute(abortMutation, 'abort');
        }}
        onCancel={() => setShowAbortDialog(false)}
      />
    </div>
  );
}
