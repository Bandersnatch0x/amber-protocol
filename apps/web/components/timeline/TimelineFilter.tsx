export function TimelineFilter({
  selectedType,
  onTypeChange,
  searchQuery,
  onSearchChange,
}: {
  selectedType: string;
  onTypeChange: (type: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const eventTypes = [
    { value: '', label: 'All Events' },
    { value: 'session-started', label: 'Session Started' },
    { value: 'session-completed', label: 'Session Completed' },
    { value: 'stage-started', label: 'Stage Started' },
    { value: 'stage-completed', label: 'Stage Completed' },
    { value: 'gate-reached', label: 'Gate Reached' },
    { value: 'error', label: 'Errors' },
    { value: 'warning', label: 'Warnings' },
  ];

  return (
    <div className="flex gap-4 mb-6">
      <select
        value={selectedType}
        onChange={(e) => onTypeChange(e.target.value)}
        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {eventTypes.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Search events..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
