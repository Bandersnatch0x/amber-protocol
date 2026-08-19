export interface Settings {
  autoRefresh: boolean;
  refreshInterval: number;
  showNotifications: boolean;
  compactView: boolean;
}

export function normalizeSettings(settings: Settings): Settings {
  return {
    autoRefresh: Boolean(settings.autoRefresh),
    refreshInterval: Math.min(60, Math.max(1, Math.round(settings.refreshInterval))),
    showNotifications: Boolean(settings.showNotifications),
    compactView: Boolean(settings.compactView),
  };
}

export function hasSettingsChanges(current: Settings, persisted: Settings): boolean {
  const normalizedCurrent = normalizeSettings(current);
  const normalizedPersisted = normalizeSettings(persisted);

  return (
    normalizedCurrent.autoRefresh !== normalizedPersisted.autoRefresh ||
    normalizedCurrent.refreshInterval !== normalizedPersisted.refreshInterval ||
    normalizedCurrent.showNotifications !== normalizedPersisted.showNotifications ||
    normalizedCurrent.compactView !== normalizedPersisted.compactView
  );
}
