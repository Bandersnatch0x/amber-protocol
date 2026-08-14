import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { normalizeSettings, type Settings } from '@/features/settings/settings-model';

export const SETTINGS_STORAGE_KEY = 'amber-web-settings';

export const defaultSettings: Settings = {
  autoRefresh: true,
  refreshInterval: 5,
  showNotifications: true,
  compactView: false,
};

export function loadStoredSettings(): Settings {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SETTINGS_STORAGE_KEY) : null;
    if (!raw) return defaultSettings;
    return normalizeSettings({ ...defaultSettings, ...JSON.parse(raw) });
  } catch {
    return defaultSettings;
  }
}

interface SettingsContextValue {
  settings: Settings;
  setSettings: (next: Settings | ((prev: Settings) => Settings)) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  saveSettings: (next: Settings) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadStoredSettings);

  const saveSettings = useCallback((next: Settings) => {
    const normalized = normalizeSettings(next);
    setSettingsState(normalized);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // ignore storage errors
    }
  }, []);

  const setSettings = useCallback((next: Settings | ((prev: Settings) => Settings)) => {
    setSettingsState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      const normalized = normalizeSettings(resolved);
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // ignore storage errors
      }
      return normalized;
    });
  }, []);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, [setSettings]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_STORAGE_KEY && event.newValue) {
        try {
          setSettingsState(normalizeSettings({ ...defaultSettings, ...JSON.parse(event.newValue) }));
        } catch {
          // ignore parsing errors
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const value = useMemo(
    () => ({ settings, setSettings, updateSetting, saveSettings }),
    [settings, setSettings, updateSetting, saveSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    return {
      settings: defaultSettings,
      setSettings: () => {},
      updateSetting: () => {},
      saveSettings: () => {},
    };
  }
  return context;
}
