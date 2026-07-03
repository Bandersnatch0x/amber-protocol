import { createFileRoute } from '@tanstack/react-router';
import { useState, useCallback } from 'react';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

interface Settings {
  autoRefresh: boolean;
  refreshInterval: number;
  showNotifications: boolean;
  compactView: boolean;
}

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
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const handleSave = useCallback(() => {
    setSaveError(null);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError('Failed to save settings. Storage may be full or unavailable.');
      setTimeout(() => setSaveError(null), 4000);
    }
  }, [settings]);

  return (
    <div className="page-container max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">Settings</h1>

      <div className="space-y-4">
        <div className="card p-5">
          <h2 className="section-title mb-4">Display</h2>
          <label className="flex items-center justify-between py-2">
            <div>
              <span className="text-sm text-slate-700 dark:text-slate-300">Compact View</span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Reduce padding and spacing in lists</p>
            </div>
            <input
              type="checkbox"
              checked={settings.compactView}
              onChange={(e) => update('compactView', e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-blue-600 focus:ring-blue-500"
            />
          </label>
        </div>

        <div className="card p-5">
          <h2 className="section-title mb-4">Updates</h2>
          <div className="space-y-4">
            <label className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-slate-700 dark:text-slate-300">Auto Refresh</span>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Poll for new data at a regular interval</p>
              </div>
              <input
                type="checkbox"
                checked={settings.autoRefresh}
                onChange={(e) => update('autoRefresh', e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-blue-600 focus:ring-blue-500"
              />
            </label>
            {settings.autoRefresh && (
              <div>
                <label htmlFor="refresh-interval" className="block text-sm text-slate-700 dark:text-slate-300 mb-2">
                  Refresh Interval (seconds)
                </label>
                <input
                  id="refresh-interval"
                  type="range"
                  min="1"
                  max="60"
                  step="1"
                  value={settings.refreshInterval}
                  onChange={(e) => update('refreshInterval', parseInt(e.target.value))}
                  className="w-full accent-blue-600"
                  aria-label="Refresh interval in seconds"
                />
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-1">
                  <span>1s</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{settings.refreshInterval}s</span>
                  <span>60s</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="section-title mb-4">Notifications</h2>
          <label className="flex items-center justify-between py-2">
            <div>
              <span className="text-sm text-slate-700 dark:text-slate-300">Show Notifications</span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Alerts when sessions complete or fail</p>
            </div>
            <input
              type="checkbox"
              checked={settings.showNotifications}
              onChange={(e) => update('showNotifications', e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-blue-600 focus:ring-blue-500"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          {saved && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Saved
            </span>
          )}
          {saveError && (
            <span className="text-sm text-red-600 dark:text-red-400">{saveError}</span>
          )}
          <button className="btn-primary" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}
