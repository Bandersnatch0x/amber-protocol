'use client';

import { useState, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useSettingsStore } from '@/lib/stores/settings-store';

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

export function useSettings(userId: string) {
  const store = useSettingsStore();
  const [isSaving, setIsSaving] = useState(false);

  const { data: settings, isLoading } = trpc.settings.getSettings.useQuery(
    { userId },
    {
      onSuccess: (data) => store.setSettings(data),
      refetchOnWindowFocus: false,
    }
  );

  const updateMutation = trpc.settings.updateSettings.useMutation({
    onMutate: async (variables) => {
      // Optimistic update
      const previous = store.settings;
      store.setSettings({
        ...previous!,
        data: variables.data,
      });
      return { previous };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        store.setSettings(context.previous);
      }

      if (error.data?.code === 'CONFLICT') {
        store.setError('Settings were modified by another session. Please refresh.');
      } else {
        store.setError('Failed to save settings. Retrying...');
      }
    },
    onSuccess: (data) => {
      store.setSettings(data);
      store.clearDirty();
      store.setError(null);
    },
  });

  const saveWithRetry = useCallback(
    async (data: Record<string, unknown>, version: number) => {
      setIsSaving(true);
      let lastError: Error | null = null;

      for (let i = 0; i < RETRY_ATTEMPTS; i++) {
        try {
          await updateMutation.mutateAsync({ userId, data, version });
          setIsSaving(false);
          return true;
        } catch (error) {
          lastError = error as Error;
          if (i < RETRY_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (i + 1)));
          }
        }
      }

      setIsSaving(false);
      store.setError(`Failed to save after ${RETRY_ATTEMPTS} attempts`);
      return false;
    },
    [userId, updateMutation, store]
  );

  return {
    settings,
    isLoading,
    isSaving,
    error: store.error,
    dirtyFields: store.dirtyFields,
    save: saveWithRetry,
    markDirty: store.markDirty,
    clearDirty: store.clearDirty,
  };
}

export function usePreferences(userId: string) {
  const store = useSettingsStore();

  const { data: preferences, isLoading } = trpc.settings.getPreferences.useQuery(
    { userId },
    {
      onSuccess: (data) => store.setPreferences(data),
      refetchOnWindowFocus: false,
    }
  );

  const updateMutation = trpc.settings.updatePreferences.useMutation({
    onMutate: async (variables) => {
      const previous = store.preferences;
      store.setPreferences({
        ...previous!,
        ...variables,
        version: previous!.version,
      });
      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous) {
        store.setPreferences(context.previous);
      }
    },
    onSuccess: (data) => {
      store.setPreferences(data);
    },
  });

  const updatePreferences = useCallback(
    async (updates: Partial<typeof preferences>) => {
      if (!preferences) return;

      await updateMutation.mutateAsync({
        userId,
        ...updates,
        version: preferences.version,
      });
    },
    [userId, preferences, updateMutation]
  );

  return {
    preferences,
    isLoading,
    updatePreferences,
  };
}
