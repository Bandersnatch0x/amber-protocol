'use client';

import { useState } from 'react';
import type { UserSettings } from '@/lib/types/settings';
import { SettingField } from '../SettingField';

interface AccountSectionProps {
  settings: UserSettings;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  onMarkDirty: (field: string) => void;
}

export function AccountSection({ settings, onSave, onMarkDirty }: AccountSectionProps) {
  const [email, setEmail] = useState((settings.data.email as string) || '');
  const [timezone, setTimezone] = useState((settings.data.timezone as string) || 'UTC');

  const handleEmailChange = (value: string) => {
    setEmail(value);
    onMarkDirty('email');
  };

  const handleTimezoneChange = (value: string) => {
    setTimezone(value);
    onMarkDirty('timezone');
  };

  const handleSave = async () => {
    await onSave({ ...settings.data, email, timezone });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Account</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Manage your account information
        </p>
      </div>

      <div className="space-y-4">
        <SettingField
          label="Email Address"
          description="Your primary email address"
          type="text"
          value={email}
          onChange={handleEmailChange}
        />

        <SettingField
          label="Timezone"
          description="Your preferred timezone"
          type="select"
          value={timezone}
          options={[
            { value: 'UTC', label: 'UTC' },
            { value: 'America/New_York', label: 'Eastern Time' },
            { value: 'America/Los_Angeles', label: 'Pacific Time' },
            { value: 'Europe/London', label: 'London' },
            { value: 'Asia/Tokyo', label: 'Tokyo' },
          ]}
          onChange={handleTimezoneChange}
        />

        <div className="pt-4">
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
