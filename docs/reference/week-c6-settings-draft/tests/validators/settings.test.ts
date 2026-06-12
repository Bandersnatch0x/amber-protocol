import { describe, it, expect, beforeEach } from 'vitest';
import { settingsUpdateSchema, preferencesUpdateSchema, settingsExportSchema } from '@/lib/validators/settings';

describe('Settings Validators', () => {
  describe('settingsUpdateSchema', () => {
    it('validates valid settings update', () => {
      const data = {
        data: { key: 'value', nested: { foo: 'bar' } },
        version: 1,
      };
      expect(() => settingsUpdateSchema.parse(data)).not.toThrow();
    });

    it('rejects negative version', () => {
      const data = { data: {}, version: -1 };
      expect(() => settingsUpdateSchema.parse(data)).toThrow();
    });

    it('rejects zero version', () => {
      const data = { data: {}, version: 0 };
      expect(() => settingsUpdateSchema.parse(data)).toThrow();
    });
  });

  describe('preferencesUpdateSchema', () => {
    it('validates valid appearance update', () => {
      const data = {
        appearance: { theme: 'dark', density: 'compact' },
        version: 1,
      };
      expect(() => preferencesUpdateSchema.parse(data)).not.toThrow();
    });

    it('validates partial update', () => {
      const data = {
        notifications: { email: false, push: true },
        version: 1,
      };
      expect(() => preferencesUpdateSchema.parse(data)).not.toThrow();
    });

    it('rejects invalid theme', () => {
      const data = {
        appearance: { theme: 'invalid', density: 'compact' },
        version: 1,
      };
      expect(() => preferencesUpdateSchema.parse(data)).toThrow();
    });
  });

  describe('settingsExportSchema', () => {
    it('validates valid export', () => {
      const data = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        userId: 'user-123',
        settings: { key: 'value' },
        preferences: {
          appearance: { theme: 'system', density: 'comfortable' },
          localization: { locale: 'en', timezone: 'UTC' },
          notifications: { email: true, push: false },
        },
      };
      expect(() => settingsExportSchema.parse(data)).not.toThrow();
    });

    it('rejects unsupported version', () => {
      const data = {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        userId: 'user-123',
        settings: {},
        preferences: {
          appearance: { theme: 'system', density: 'comfortable' },
          localization: { locale: 'en', timezone: 'UTC' },
          notifications: { email: true, push: false },
        },
      };
      expect(() => settingsExportSchema.parse(data)).toThrow();
    });
  });
});
