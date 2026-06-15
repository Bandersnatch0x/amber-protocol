import { TIMELINE_EVENT_TYPES } from './timeline-config';

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
  return (
    <div className="flex gap-4 mb-6">
      <select
        value={selectedType}
        onChange={(e) => onTypeChange(e.target.value)}
        aria-label="Filter by event type"
        className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All Events</option>
        {TIMELINE_EVENT_TYPES.map((type) => (
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
        aria-label="Search events"
        className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
