import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { hasSettingsChanges, normalizeSettings, type Settings } from '@/features/settings/settings-model';
import { useI18n } from '@/lib/i18n';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

const STORAGE_KEY = 'amber-web-settings';

const defaults: Settings = {
  autoRefresh: true,
  refreshInterval: 5,
  showNotifications: true,
  compactView: false,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return normalizeSettings({ ...defaults, ...JSON.parse(raw) });
  } catch {
    return defaults;
  }
}

function SettingsPage() {
  const { t } = useI18n();
  const [persistedSettings, setPersistedSettings] = useState<Settings>(loadSettings);
  const [settings, setSettings] = useState<Settings>(persistedSettings);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(() => hasSettingsChanges(settings, persistedSettings), [settings, persistedSettings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((previous) => normalizeSettings({ ...previous, [key]: value }));
    setSaved(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaved(false);
    setIsSaving(true);

    try {
      const normalized = normalizeSettings(settings);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      setPersistedSettings(normalized);
      setSettings(normalized);
      setSaved(true);
    } catch {
      setSaveError(t('settings.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [settings, t]);

  return (
    <div className="page-container max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">{t('settings.title')}</h1>
      </header>

      <section className="card p-5">
        <h2 className="section-title">{t('settings.display')}</h2>
        <label className="mt-4 flex items-start justify-between gap-4">
          <div>
            <span className="text-sm text-slate-900 dark:text-white">{t('settings.compactView')}</span>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('settings.compactViewDetail')}</p>
          </div>
          <input
            type="checkbox"
            checked={settings.compactView}
            onChange={(event) => update('compactView', event.target.checked)}
            className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
          />
        </label>
      </section>

      <section className="card p-5">
        <h2 className="section-title">{t('settings.updates')}</h2>
        <div className="mt-4 space-y-4">
          <label className="flex items-start justify-between gap-4">
            <div>
              <span className="text-sm text-slate-900 dark:text-white">{t('settings.autoRefresh')}</span>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('settings.autoRefreshDetail')}</p>
            </div>
            <input
              type="checkbox"
              checked={settings.autoRefresh}
              onChange={(event) => update('autoRefresh', event.target.checked)}
              className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
            />
          </label>

          {settings.autoRefresh && (
            <div>
              <label htmlFor="refresh-interval" className="block text-sm text-slate-900 dark:text-white">
                {t('settings.refreshInterval')}
              </label>
              <input
                id="refresh-interval"
                type="range"
                min="1"
                max="60"
                step="1"
                value={settings.refreshInterval}
                onChange={(event) => update('refreshInterval', Number(event.target.value))}
                className="mt-3 w-full accent-blue-600"
                aria-label={t('settings.refreshIntervalAria')}
              />
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>1s</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{settings.refreshInterval}s</span>
                <span>60s</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="section-title">{t('settings.notifications')}</h2>
        <label className="mt-4 flex items-start justify-between gap-4">
          <div>
            <span className="text-sm text-slate-900 dark:text-white">{t('settings.showNotifications')}</span>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('settings.showNotificationsDetail')}</p>
          </div>
          <input
            type="checkbox"
            checked={settings.showNotifications}
            onChange={(event) => update('showNotifications', event.target.checked)}
            className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
          />
        </label>
      </section>

      <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-700" aria-live="polite">
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">{t('common.saved')}</span>}
        {saveError && <span className="text-sm text-red-600 dark:text-red-400">{saveError}</span>}
        <button className="btn-primary" onClick={handleSave} disabled={!isDirty || isSaving}>
          {isSaving ? t('common.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  );
}
