import { describe, expect, it } from 'vitest';
import { hasSettingsChanges, normalizeSettings } from './settings-model';

describe('normalizeSettings', () => {
  it('clamps refresh interval into the supported 1s to 60s range', () => {
    expect(
      normalizeSettings({
        autoRefresh: true,
        refreshInterval: 0,
        showNotifications: true,
        compactView: false,
      }).refreshInterval,
    ).toBe(1);
    expect(
      normalizeSettings({
        autoRefresh: true,
        refreshInterval: 99,
        showNotifications: true,
        compactView: false,
      }).refreshInterval,
    ).toBe(60);
  });
});

describe('hasSettingsChanges', () => {
  const base = normalizeSettings({
    autoRefresh: true,
    refreshInterval: 5,
    showNotifications: true,
    compactView: false,
  });

  it('returns false when nothing changed', () => {
    expect(hasSettingsChanges(base, base)).toBe(false);
  });

  it('returns true when any persisted field changes', () => {
    expect(hasSettingsChanges(base, { ...base, compactView: true })).toBe(true);
    expect(hasSettingsChanges(base, { ...base, autoRefresh: false })).toBe(true);
    expect(hasSettingsChanges(base, { ...base, refreshInterval: 10 })).toBe(true);
  });
});
