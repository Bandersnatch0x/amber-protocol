import { create } from 'zustand';
import type { UserSettings, UserPreferences } from '@/lib/types/settings';

interface SettingsState {
  settings: UserSettings | null;
  preferences: UserPreferences | null;
  isLoading: boolean;
  error: string | null;
  dirtyFields: Set<string>;

  setSettings: (settings: UserSettings) => void;
  setPreferences: (preferences: UserPreferences) => void;
  markDirty: (field: string) => void;
  clearDirty: () => void;
  setError: (error: string | null) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  preferences: null,
  isLoading: false,
  error: null,
  dirtyFields: new Set(),

  setSettings: (settings) => set({ settings }),
  setPreferences: (preferences) => set({ preferences }),
  markDirty: (field) =>
    set((state) => ({
      dirtyFields: new Set(state.dirtyFields).add(field),
    })),
  clearDirty: () => set({ dirtyFields: new Set() }),
  setError: (error) => set({ error }),
}));
