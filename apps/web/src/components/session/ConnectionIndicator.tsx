import { useI18n, type I18nKey } from '@/lib/i18n';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

interface ConnectionIndicatorProps {
  state: ConnectionState;
  onRetry?: () => void;
  reconnectAttempt?: number;
}

const stateConfig: Record<
  ConnectionState,
  { labelKey: I18nKey; dotClass: string; textClass: string }
> = {
  open: {
    labelKey: 'sessions.connection.open',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  connecting: {
    labelKey: 'sessions.connection.connecting',
    dotClass: 'bg-amber-500 animate-pulse',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  closed: {
    labelKey: 'sessions.connection.closed',
    dotClass: 'bg-slate-400',
    textClass: 'text-slate-500 dark:text-slate-400',
  },
  error: {
    labelKey: 'sessions.connection.error',
    dotClass: 'bg-red-500',
    textClass: 'text-red-600 dark:text-red-400',
  },
};

export function ConnectionIndicator({
  state,
  onRetry,
  reconnectAttempt,
}: ConnectionIndicatorProps) {
  const { t } = useI18n();
  const config = stateConfig[state];

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <div className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
        <span className={`text-xs font-medium ${config.textClass}`}>
          {t(config.labelKey)}
          {reconnectAttempt && reconnectAttempt > 0 && state === 'connecting'
            ? ` (${reconnectAttempt})`
            : ''}
        </span>
      </div>

      {state === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-700 underline-offset-2 hover:bg-red-50 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-red-500 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          {t('sessions.connection.retry')}
        </button>
      )}
    </div>
  );
}
