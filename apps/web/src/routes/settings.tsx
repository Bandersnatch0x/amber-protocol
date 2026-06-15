import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

function SettingsPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [showNotifications, setShowNotifications] = useState(true);
  const [compactView, setCompactView] = useState(false);

  return (
    <div className="page-container max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">Settings</h1>

      <div className="space-y-4">
        <div className="card p-5">
          <h2 className="section-title mb-4">Display</h2>
          <label className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-700 dark:text-slate-300">Compact View</span>
            <input
              type="checkbox"
              checked={compactView}
              onChange={(e) => setCompactView(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-blue-600 focus:ring-blue-500"
            />
          </label>
        </div>

        <div className="card p-5">
          <h2 className="section-title mb-4">Updates</h2>
          <div className="space-y-4">
            <label className="flex items-center justify-between py-2">
              <span className="text-sm text-slate-700 dark:text-slate-300">Auto Refresh</span>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-blue-600 focus:ring-blue-500"
              />
            </label>
            {autoRefresh && (
              <div>
                <label className="block text-sm text-slate-700 dark:text-slate-300 mb-2">
                  Refresh Interval (seconds)
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
                  className="w-32 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="section-title mb-4">Notifications</h2>
          <label className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-700 dark:text-slate-300">Show Notifications</span>
            <input
              type="checkbox"
              checked={showNotifications}
              onChange={(e) => setShowNotifications(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-blue-600 focus:ring-blue-500"
            />
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <button className="btn-primary">Save Settings</button>
        </div>
      </div>
    </div>
  );
}
