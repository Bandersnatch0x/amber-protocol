// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { dictionaries } from '@/lib/i18n';

describe('i18n dictionaries', () => {
  const enKeys = Object.keys(dictionaries.en).sort();
  const zhKeys = Object.keys(dictionaries['zh-CN']).sort();

  it('keeps the en and zh-CN key sets identical', () => {
    expect(zhKeys).toEqual(enKeys);
  });

  it('has no empty values in either dictionary', () => {
    for (const key of enKeys) {
      expect(dictionaries.en[key as keyof typeof dictionaries.en], key).not.toBe('');
      expect(dictionaries['zh-CN'][key as keyof typeof dictionaries.en], key).not.toBe('');
    }
  });

  it('includes the transcript timeline namespace in both languages', () => {
    const expected = [
      'transcript.chip.slashCommand',
      'transcript.chip.commandStdout',
      'transcript.chip.taskNotification',
      'transcript.chip.recap',
      'transcript.expand',
      'transcript.collapse',
      'transcript.viewRaw',
      'transcript.hideRaw',
      'transcript.turnSeparator',
      'transcript.role.user',
      'transcript.role.assistant',
      'transcript.role.system',
      'transcript.role.tool',
      'transcript.hidden.localCommand.label',
      'transcript.hidden.localCommand.summary',
      'transcript.hidden.localCommand.summaryOne',
      'transcript.hidden.localCommand.description',
      'transcript.hidden.systemReminder.label',
      'transcript.hidden.systemReminder.summary',
      'transcript.hidden.systemReminder.summaryOne',
      'transcript.hidden.systemReminder.description',
    ];

    for (const key of expected) {
      expect(enKeys, key).toContain(key);
      expect(zhKeys, key).toContain(key);
    }
  });
});
