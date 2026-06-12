'use client';

import type { UserPreferences } from '@/lib/types/settings';
import { SettingField } from '../SettingField';

interface NotificationsSectionProps {
  preferences: UserPreferences;
  onUpdate: (updates: Partial<UserPreferences>) => Promise<void>;
}

export function NotificationsSection({ preferences, onUpdate }: NotificationsSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Manage how and when you receive notifications
        </p>
      </div>

      <div className="space-y-4">
        <SettingField
          label="Email Notifications"
          description="Receive notifications via email"
          type="toggle"
          value={preferences.notifications.email}
          onChange={(value) =>
            onUpdate({
              notifications: { ...preferences.notifications, email: value },
            })
          }
        />

        <SettingField
          label="Push Notifications"
          description="Receive push notifications in your browser"
          type="toggle"
          value={preferences.notifications.push}
          onChange={(value) =>
            onUpdate({
              notifications: { ...preferences.notifications, push: value },
            })
          }
        />
      </div>
    </div>
  );
}
