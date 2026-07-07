import { TIMELINE_EVENT_TYPES } from './timeline-config';
import { useI18n, type I18nKey } from '@/lib/i18n';

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
  const { t } = useI18n();

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center">
      <select
        value={selectedType}
        onChange={(e) => onTypeChange(e.target.value)}
        aria-label={t('timeline.filterAria')}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:max-w-[220px]"
      >
        <option value="">{t('timeline.filterAll')}</option>
        {TIMELINE_EVENT_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {t(`timeline.event.${type.value}` as I18nKey)}
          </option>
        ))}
      </select>

      <div className="relative flex-1">
        <input
          type="text"
          placeholder={t('timeline.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={t('timeline.searchAria')}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 dark:text-slate-500">
          /
        </span>
      </div>
    </div>
  );
}
