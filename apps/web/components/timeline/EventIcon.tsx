export function EventIcon({ type }: { type: string }) {
  const icons: Record<string, { emoji: string; color: string }> = {
    'session-started': { emoji: '▶️', color: 'text-blue-600' },
    'session-completed': { emoji: '✅', color: 'text-green-600' },
    'session-failed': { emoji: '❌', color: 'text-red-600' },
    'session-paused': { emoji: '⏸️', color: 'text-yellow-600' },
    'session-resumed': { emoji: '▶️', color: 'text-blue-600' },
    'stage-started': { emoji: '🔵', color: 'text-purple-600' },
    'stage-completed': { emoji: '✅', color: 'text-green-600' },
    'stage-failed': { emoji: '❌', color: 'text-red-600' },
    'gate-reached': { emoji: '🚪', color: 'text-yellow-600' },
    'gate-approved': { emoji: '✓', color: 'text-green-600' },
    'gate-rejected': { emoji: '✗', color: 'text-red-600' },
    'error': { emoji: '⚠️', color: 'text-red-600' },
    'warning': { emoji: '⚠️', color: 'text-yellow-600' },
    'info': { emoji: 'ℹ️', color: 'text-blue-600' },
    'tool-call': { emoji: '🔧', color: 'text-gray-600' },
    'agent-spawn': { emoji: '🤖', color: 'text-purple-600' },
  };

  const config = icons[type] || { emoji: '○', color: 'text-gray-400' };

  return (
    <div className={`flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800 ${config.color}`}>
      <span className="text-xl">{config.emoji}</span>
    </div>
  );
}
