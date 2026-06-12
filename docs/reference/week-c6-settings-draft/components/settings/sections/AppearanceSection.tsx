'use client';

import type { UserPreferences } from '@/lib/types/settings';
import { SettingField } from '../SettingField';

interface AppearanceSectionProps {
  preferences: UserPreferences;
  onUpdate: (updates: Partial<UserPreferences>) => Promise<void>;
}

export function AppearanceSection({ preferences, onUpdate }: AppearanceSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Appearance</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Customize how the interface looks and feels
        </p>
      </div>

      <div className="space-y-4">
        <SettingField
          label="Theme"
          description="Choose your preferred color theme"
          type="select"
          value={preferences.appearance.theme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
          onChange={(value) =>
            onUpdate({
              appearance: { ...preferences.appearance, theme: value as any },
            })
          }
        />

        <SettingField
          label="Density"
          description="Adjust the spacing and size of interface elements"
          type="select"
          value={preferences.appearance.density}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          onChange={(value) =>
            onUpdate({
              appearance: { ...preferences.appearance, density: value as any },
            })
          }
        />
      </div>
    </div>
  );
}
