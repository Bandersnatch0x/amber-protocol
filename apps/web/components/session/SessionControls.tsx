'use client';

import { useState } from 'react';
import { useSessionEvents } from '@/lib/hooks/useSessionEvents';
import { ConfirmAbortDialog } from './ConfirmAbortDialog';
import { trpc } from '@/lib/trpc';

interface SessionControlsProps {
  sessionId: string;
}

export function SessionControls({ sessionId }: SessionControlsProps) {
  const { status } = useSessionEvents(sessionId);
  const [isLoading, setIsLoading] = useState(false);
  const [showAbortDialog, setShowAbortDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startMutation = trpc.sessionControl.start.useMutation();
  const pauseMutation = trpc.sessionControl.pause.useMutation();
  const resumeMutation = trpc.sessionControl.resume.useMutation();
  const abortMutation = trpc.sessionControl.abort.useMutation();

  const handleStart = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      await startMutation.mutateAsync({ sessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      await pauseMutation.mutateAsync({ sessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause session');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResume = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      await resumeMutation.mutateAsync({ sessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume session');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAbort = async () => {
    setShowAbortDialog(false);
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      await abortMutation.mutateAsync({ sessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to abort session');
    } finally {
      setIsLoading(false);
    }
  };

  const canStart = status === 'idle' && !isLoading;
  const canPause = status === 'running' && !isLoading;
  const canResume = status === 'paused' && !isLoading;
  const canAbort = (status === 'running' || status === 'paused') && !isLoading;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={handleStart}
          disabled={!canStart}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white"
        >
          {isLoading ? 'Loading...' : 'Start'}
        </button>

        <button
          onClick={handlePause}
          disabled={!canPause}
          className="px-4 py-2 rounded bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white"
        >
          Pause
        </button>

        <button
          onClick={handleResume}
          disabled={!canResume}
          className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white"
        >
          Resume
        </button>

        <button
          onClick={() => setShowAbortDialog(true)}
          disabled={!canAbort}
          className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white"
        >
          Abort
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      <ConfirmAbortDialog
        isOpen={showAbortDialog}
        onConfirm={handleAbort}
        onCancel={() => setShowAbortDialog(false)}
      />
    </div>
  );
}
