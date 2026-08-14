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

function parseStoredSettings(raw: string): Settings {
  return normalizeSettings({ ...defaultSettings, ...JSON.parse(raw) });
}

export function loadStoredSettings(): Settings {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SETTINGS_STORAGE_KEY) : null;
    return raw ? parseStoredSettings(raw) : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

function persistSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

interface SettingsContextValue {
  settings: Settings;
  setSettings: (next: Settings | ((prev: Settings) => Settings)) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadStoredSettings);

  const setSettings = useCallback((next: Settings | ((prev: Settings) => Settings)) => {
    setSettingsState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      const normalized = normalizeSettings(resolved);
      persistSettings(normalized);
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
          setSettingsState(parseStoredSettings(event.newValue));
        } catch {
          // ignore parsing errors
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const value = useMemo(
    () => ({ settings, setSettings, updateSetting }),
    [settings, setSettings, updateSetting],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
