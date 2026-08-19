import { describe, expect, it } from 'vitest';
import { dictionaries, interpolate, type I18nKey, type Language } from '@/lib/i18n';
import {
  localizeCompletionHint,
  localizeExpectedOutcome,
  localizeLifecycleCopy,
  localizeLifecycleWhy,
} from './backend-copy';

/** Translate through a real dictionary so mappings and copy stay honest. */
function translator(language: Language) {
  return (key: I18nKey, params?: Record<string, string | number>): string =>
    interpolate(dictionaries[language][key], params);
}

const zh = translator('zh-CN');
const en = translator('en');

describe('localizeLifecycleWhy', () => {
  it('maps known backend strings to localized copy', () => {
    expect(localizeLifecycleWhy('the session has no verification evidence yet.', zh)).toBe(
      dictionaries['zh-CN']['ux.backend.lifecycle.why.verify'],
    );
    expect(localizeLifecycleWhy('the session has no approval evidence yet.', zh)).toBe(
      dictionaries['zh-CN']['ux.backend.lifecycle.why.approve'],
    );
    // en degrades to the identical backend string, so the English UI is unchanged.
    expect(localizeLifecycleWhy('the session has no verification evidence yet.', en)).toBe(
      'the session has no verification evidence yet.',
    );
  });

  it('is case-insensitive on exact matches', () => {
    expect(localizeLifecycleWhy('The session has no verification evidence yet.', zh)).toBe(
      dictionaries['zh-CN']['ux.backend.lifecycle.why.verify'],
    );
  });

  it('localizes dynamic approval reasons with gate id and count', () => {
    const value =
      'the session has no approval evidence yet (next gate: user-approval-plan; 3 gates on route).';
    expect(localizeLifecycleWhy(value, zh)).toBe(
      '会话还没有审批证据（下一个关卡：user-approval-plan；路由共 3 个关卡）。',
    );
  });

  it('localizes dynamic completion-check reasons with the missing list', () => {
    const value = 'the session is not yet complete (missing: verification, approval).';
    expect(localizeLifecycleWhy(value, zh)).toBe('会话尚未完成（缺少：verification, approval）。');
  });

  it('localizes dynamic plan reasons with the feature id', () => {
    expect(localizeLifecycleWhy('feature F018 has no plan yet.', zh)).toBe(
      '功能 F018 还没有计划。',
    );
  });

  it('localizes dynamic learnings reasons with matched categories', () => {
    const value =
      'accepted work touched schema/contract paths — the knowledge write-back review is not booked yet (book it with amber learnings --reviewed --owner <id>).';
    expect(localizeLifecycleWhy(value, zh)).toBe(
      '已验收的工作改动了 schema/contract 路径——经验回写评审还未登记（用 amber learnings --reviewed --owner <id> 登记）。',
    );
  });

  it('degrades unknown strings to the raw backend text', () => {
    expect(localizeLifecycleWhy('a brand new lifecycle reason nobody mapped.', zh)).toBe(
      'a brand new lifecycle reason nobody mapped.',
    );
  });
});

describe('localizeExpectedOutcome', () => {
  it('rebuilds the lifecycle outcome sentence with a localized step label', () => {
    expect(
      localizeExpectedOutcome('Lifecycle advances past: Record session verification.', zh),
    ).toBe(
      `生命周期将推进到：${dictionaries['zh-CN']['sessions.completion.backend.step.verify']}。`,
    );
  });

  it('degrades unknown step labels to the raw sentence', () => {
    const value = 'Lifecycle advances past: Some future step.';
    expect(localizeExpectedOutcome(value, zh)).toBe(value);
  });

  it('leaves non-outcome strings untouched', () => {
    expect(localizeExpectedOutcome('Anything else entirely.', zh)).toBe('Anything else entirely.');
  });
});

describe('localizeLifecycleCopy', () => {
  it('routes outcome sentences and why strings through the right localizer', () => {
    expect(
      localizeLifecycleCopy('Lifecycle advances past: Record session verification.', zh),
    ).toContain('生命周期将推进到');
    expect(localizeLifecycleCopy('the session has no verification evidence yet.', zh)).toBe(
      dictionaries['zh-CN']['ux.backend.lifecycle.why.verify'],
    );
  });
});

describe('localizeCompletionHint', () => {
  it('maps known completion hints to localized copy', () => {
    expect(localizeCompletionHint('Run verification from the console evidence runner.', zh)).toBe(
      dictionaries['zh-CN']['ux.backend.completion.hint.verification'],
    );
    expect(localizeCompletionHint('Approve via the gates view (/gates).', zh)).toBe(
      dictionaries['zh-CN']['ux.backend.completion.hint.approval'],
    );
    expect(localizeCompletionHint('All completion checks pass — close the session.', zh)).toBe(
      dictionaries['zh-CN']['ux.backend.completion.hint.sessionComplete'],
    );
  });

  it('localizes the dynamic unknown-item fallback with the item name', () => {
    expect(localizeCompletionHint('Resolve the missing completion item: handoff.', zh)).toBe(
      '补齐缺失的完成项：handoff。',
    );
  });

  it('degrades unknown hints to the raw backend text', () => {
    expect(localizeCompletionHint('Some unmapped guidance.', zh)).toBe('Some unmapped guidance.');
  });
});
