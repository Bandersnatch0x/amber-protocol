import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import {
  hasSettingsChanges,
  normalizeSettings,
  type Settings,
} from '@/features/settings/settings-model';
import { useI18n } from '@/lib/i18n';
import { useSettings } from '@/lib/settings-provider';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

function SettingsPage() {
  const { t } = useI18n();
  const { settings: globalSettings, setSettings: saveSettings } = useSettings();
  const [persistedSettings, setPersistedSettings] = useState<Settings>(globalSettings);
  const [settings, setSettings] = useState<Settings>(globalSettings);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset the local form when the global settings change from outside this
  // page (storage event or another surface saving). Render-time adjustment is
  // the react.dev replacement for copying a prop into state via an effect.
  const [prevGlobalSettings, setPrevGlobalSettings] = useState(globalSettings);
  if (prevGlobalSettings !== globalSettings) {
    setPrevGlobalSettings(globalSettings);
    setPersistedSettings(globalSettings);
    setSettings(globalSettings);
  }

  const isDirty = useMemo(
    () => hasSettingsChanges(settings, persistedSettings),
    [settings, persistedSettings],
  );

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
      saveSettings(normalized);
      setPersistedSettings(normalized);
      setSettings(normalized);
      setSaved(true);
    } catch {
      setSaveError(t('settings.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [settings, saveSettings, t]);

  return (
    <div className="page-container max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">
          {t('settings.title')}
        </h1>
      </header>

      <section className="card p-5">
        <h2 className="section-title">{t('settings.display')}</h2>
        <label className="mt-4 flex items-start justify-between gap-4">
          <div>
            <span className="text-sm text-slate-900 dark:text-white">
              {t('settings.compactView')}
            </span>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('settings.compactViewDetail')}
            </p>
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
              <span className="text-sm text-slate-900 dark:text-white">
                {t('settings.autoRefresh')}
              </span>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t('settings.autoRefreshDetail')}
              </p>
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
              <label
                htmlFor="refresh-interval"
                className="block text-sm text-slate-900 dark:text-white"
              >
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
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {settings.refreshInterval}s
                </span>
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
            <span className="text-sm text-slate-900 dark:text-white">
              {t('settings.showNotifications')}
            </span>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('settings.showNotificationsDetail')}
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.showNotifications}
            onChange={(event) => update('showNotifications', event.target.checked)}
            className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
          />
        </label>
      </section>

      <div
        className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-700"
        aria-live="polite"
      >
        {saved && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            {t('common.saved')}
          </span>
        )}
        {saveError && <span className="text-sm text-red-600 dark:text-red-400">{saveError}</span>}
        <button className="btn-primary" onClick={handleSave} disabled={!isDirty || isSaving}>
          {isSaving ? t('common.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  );
}
