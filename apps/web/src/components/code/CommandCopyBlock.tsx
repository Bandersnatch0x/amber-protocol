import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

interface CommandCopyBlockProps {
  command: string;
  hint?: string;
  className?: string;
}

/**
 * Read-only CLI command surface with a copy button. Amber's governance model
 * (ADR-0007) forbids the web console from executing CLI-only actions, so this
 * component only ever copies the command to the clipboard — it never runs it.
 */
export function CommandCopyBlock({ command, hint, className = '' }: CommandCopyBlockProps) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyLabel =
    copyState === 'copied'
      ? t('code.copied')
      : copyState === 'failed'
        ? t('code.copyFailed')
        : t('code.copy');

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  }

  return (
    <div
      className={`rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60 ${className}`}
    >
      {hint && <p className="mb-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</p>}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-slate-800 dark:bg-slate-950/60 dark:text-slate-200">
          {command}
        </code>
        <button
          type="button"
          onClick={copyCommand}
          className="shrink-0 rounded px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
        >
          <span aria-live="polite">{copyLabel}</span>
        </button>
      </div>
    </div>
  );
}
