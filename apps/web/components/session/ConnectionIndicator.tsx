'use client';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

interface ConnectionIndicatorProps {
  state: ConnectionState;
}

const stateConfig: Record<ConnectionState, { label: string; className: string }> = {
  open: { label: 'Connected', className: 'bg-green-500' },
  connecting: { label: 'Connecting...', className: 'bg-yellow-500 animate-pulse' },
  closed: { label: 'Disconnected', className: 'bg-gray-400' },
  error: { label: 'Connection Error', className: 'bg-red-500' },
};

export function ConnectionIndicator({ state }: ConnectionIndicatorProps) {
  const config = stateConfig[state];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${config.className}`} title={config.label} />
      <span className="text-xs text-gray-600 dark:text-gray-400">{config.label}</span>
    </div>
  );
}
