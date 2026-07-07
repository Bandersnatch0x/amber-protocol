import { useI18n, type I18nKey } from '@/lib/i18n';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

interface ConnectionIndicatorProps {
  state: ConnectionState;
}

const stateConfig: Record<ConnectionState, { labelKey: I18nKey; dotClass: string; textClass: string }> = {
  open: { labelKey: 'sessions.connection.open', dotClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' },
  connecting: { labelKey: 'sessions.connection.connecting', dotClass: 'bg-amber-500 animate-pulse', textClass: 'text-amber-600 dark:text-amber-400' },
  closed: { labelKey: 'sessions.connection.closed', dotClass: 'bg-slate-400', textClass: 'text-slate-500 dark:text-slate-400' },
  error: { labelKey: 'sessions.connection.error', dotClass: 'bg-red-500', textClass: 'text-red-600 dark:text-red-400' },
};

export function ConnectionIndicator({ state }: ConnectionIndicatorProps) {
  const { t } = useI18n();
  const config = stateConfig[state];

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      <span className={`text-xs font-medium ${config.textClass}`}>{t(config.labelKey)}</span>
    </div>
  );
}
