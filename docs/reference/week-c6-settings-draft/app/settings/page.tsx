'use client';

import { useState } from 'react';
import { useSettings, usePreferences } from '@/lib/hooks/use-settings';
import { SettingsSidebar } from '@/components/settings/SettingsSidebar';
import { AppearanceSection } from '@/components/settings/sections/AppearanceSection';
import { NotificationsSection } from '@/components/settings/sections/NotificationsSection';
import { AccountSection } from '@/components/settings/sections/AccountSection';
import { UnsavedChangesDialog } from '@/components/settings/UnsavedChangesDialog';

const MOCK_USER_ID = 'user-1'; // Replace with actual auth

type Section = 'appearance' | 'notifications' | 'account';

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>('appearance');
  const { settings, isLoading, error, dirtyFields, save, markDirty, clearDirty } =
    useSettings(MOCK_USER_ID);
  const { preferences, updatePreferences } = usePreferences(MOCK_USER_ID);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage your account settings and preferences
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      <div className="flex gap-8">
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />

        <div className="flex-1">
          {activeSection === 'appearance' && preferences && (
            <AppearanceSection
              preferences={preferences}
              onUpdate={updatePreferences}
            />
          )}

          {activeSection === 'notifications' && preferences && (
            <NotificationsSection
              preferences={preferences}
              onUpdate={updatePreferences}
            />
          )}

          {activeSection === 'account' && settings && (
            <AccountSection
              settings={settings}
              onSave={(data) => save(data, settings.version)}
              onMarkDirty={markDirty}
            />
          )}
        </div>
      </div>

      <UnsavedChangesDialog
        isOpen={dirtyFields.size > 0}
        onSave={() => settings && save(settings.data, settings.version)}
        onDiscard={clearDirty}
      />
    </div>
  );
}
