type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

interface ConnectionIndicatorProps {
  state: ConnectionState;
}

const stateConfig: Record<ConnectionState, { label: string; dotClass: string; textClass: string }> = {
  open: { label: 'Live', dotClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' },
  connecting: { label: 'Connecting', dotClass: 'bg-amber-500 animate-pulse', textClass: 'text-amber-600 dark:text-amber-400' },
  closed: { label: 'Disconnected', dotClass: 'bg-slate-400', textClass: 'text-slate-500 dark:text-slate-400' },
  error: { label: 'Error', dotClass: 'bg-red-500', textClass: 'text-red-600 dark:text-red-400' },
};

export function ConnectionIndicator({ state }: ConnectionIndicatorProps) {
  const config = stateConfig[state];

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      <span className={`text-xs font-medium ${config.textClass}`}>{config.label}</span>
    </div>
  );
}
