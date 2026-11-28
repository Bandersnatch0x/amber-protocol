// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { FeatureBoardResult } from '../../../../../scripts/lib/web-adapter';
import { FeatureBoard } from './FeatureBoard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: ReactNode; params: { id: string } }) => (
    <a href={`/sessions/${params.id}`}>{children}</a>
  ),
}));

const states = ['not_started', 'in_progress', 'blocked', 'passing', 'accepted'];
const snapshot: FeatureBoardResult = {
  generatedAt: '2026-11-27T08:30:00Z',
  statuses: states,
  features: {
    state: 'ok',
    errors: [],
    items: states.map((status, i) => ({
      id: `F00${i + 1}`,
      title: `Feature ${i + 1}`,
      status,
      priority: i + 1,
      notes: i === 1 ? ['等待设计检查'] : [],
      evidence: i === 3 ? ['Agent 自述：完成'] : [],
    })),
  },
  sessions: {
    state: 'ok',
    errors: [],
    items: [
      {
        sessionId: 'first',
        feature: 'F002',
        goal: 'Same title',
        status: 'completed',
        currentStage: 'verify',
      },
      {
        sessionId: 'second',
        feature: 'F002',
        goal: 'Same title',
        status: 'paused',
        currentStage: '',
      },
      {
        sessionId: 'unbound',
        feature: null,
        goal: 'Unbound goal',
        status: 'created',
        currentStage: null,
      },
      {
        sessionId: 'unresolved',
        feature: 'F999',
        goal: 'Unresolved goal',
        status: 'paused',
        currentStage: 'review',
      },
    ],
  },
};

function show(
  props: Partial<ComponentProps<typeof FeatureBoard>> = {},
  language: 'en' | 'zh-CN' = 'en',
) {
  return render(
    <I18nProvider initialLanguage={language}>
      <FeatureBoard
        snapshot={snapshot}
        isLoading={false}
        isFetching={false}
        onRefresh={vi.fn()}
        onFocus={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Feature 交付聚焦列表', () => {
  it('保留五状态、原始 evidence、可展开详情和中性 passing 说明', () => {
    const { container } = show();
    expect(container.querySelectorAll('details[data-feature]').length).toBe(5);
    for (const status of states)
      expect(container.querySelector(`[data-status="${status}"]`)).toBeTruthy();
    expect(screen.getByText('Agent 自述：完成')).toBeTruthy();
    expect(screen.getByText(/does not imply independent verification/)).toBeTruthy();
    expect(container.querySelector('details[data-feature]')?.hasAttribute('open')).toBe(false);
  });

  it('同 Feature 多 Session 不丢失，筛选不隐藏独立会话，不按标题猜绑', () => {
    show();
    expect(screen.getAllByText('Same title').length).toBe(2);
    expect(screen.getAllByText('Unknown stage').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /^In progress/ }));
    expect(screen.getByText('Feature 2')).toBeTruthy();
    expect(screen.queryByText('Feature 1')).toBeNull();
    expect(screen.getByText('Unbound goal')).toBeTruthy();
    expect(screen.getByText('Unresolved goal')).toBeTruthy();
    expect(screen.getByText('F999')).toBeTruthy();
    const destinations = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(destinations).toEqual([
      '/sessions/first',
      '/sessions/second',
      '/sessions/unbound',
      '/sessions/unresolved',
    ]);
  });

  it('聚焦建议交给现有 featureId 导航，不启动或控制 Session', () => {
    const onFocus = vi.fn();
    show({ onFocus });
    fireEvent.click(screen.getAllByRole('button', { name: 'Focus recommendations' })[1]);
    expect(onFocus).toHaveBeenCalledWith('F002');
    expect(screen.queryByRole('button', { name: /approve|run session|dispatch/i })).toBeNull();
  });

  it('Feature 来源失败时保留全部 Session 和原引用，不误报引用不存在', () => {
    show({
      snapshot: { ...snapshot, features: { state: 'error', items: [], errors: ['invalid JSON'] } },
    });
    expect(screen.getByText('Feature source unavailable')).toBeTruthy();
    expect(screen.getByText('References not yet verifiable')).toBeTruthy();
    expect(screen.queryByText('Unresolved references')).toBeNull();
    expect(screen.getAllByText('Same title').length).toBe(2);
    expect(screen.getByText('F999')).toBeTruthy();
    expect(screen.queryByText('No registered Features.')).toBeNull();
    expect(screen.getByText('invalid JSON')).toBeTruthy();
  });

  it('区分合法空数据、部分失败与来源不可读', () => {
    const { unmount } = show({
      snapshot: {
        ...snapshot,
        features: { state: 'ok', items: [], errors: [] },
        sessions: { state: 'ok', items: [], errors: [] },
      },
    });
    expect(screen.getByText('No registered Features.')).toBeTruthy();
    expect(screen.getAllByText('No Sessions.').length).toBe(2);
    unmount();
    show({
      snapshot: {
        ...snapshot,
        sessions: { ...snapshot.sessions, state: 'partial', errors: ['broken manifest'] },
      },
    });
    expect(screen.getByText('Session source partially read')).toBeTruthy();
    expect(screen.getByText('broken manifest')).toBeTruthy();
    expect(screen.getAllByText('Same title').length).toBe(2);
  });

  it('刷新失败标记旧快照失效，保留最后成功时间和可重试操作', () => {
    const onRefresh = vi.fn();
    show({ error: 'read failed', onRefresh });
    expect(screen.getByText(/Previous snapshot is stale/)).toBeTruthy();
    expect(screen.getByText('2026-11-27T08:30:00Z')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh delivery snapshot' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('来源错误和部分失败保留最后健康时间，重复失败不推进，恢复后才更新', () => {
    const { rerender, container } = show();
    fireEvent.click(screen.getByRole('button', { name: /^Blocked/ }));
    function update(data: FeatureBoardResult, error?: string, featureId?: string) {
      rerender(
        <I18nProvider initialLanguage="en">
          <FeatureBoard
            snapshot={data}
            error={error}
            featureId={featureId}
            isLoading={false}
            isFetching={false}
            onRefresh={vi.fn()}
            onFocus={vi.fn()}
          />
        </I18nProvider>,
      );
    }
    const featureError: FeatureBoardResult = {
      ...snapshot,
      generatedAt: '2026-11-27T09:00:00Z',
      features: { state: 'error', items: [], errors: ['invalid JSON'] },
    };
    update(featureError);
    expect(screen.getByText(/Previous snapshot is stale/)).toBeTruthy();
    expect(container.querySelector('time')?.dateTime).toBe(snapshot.generatedAt);
    expect(screen.getAllByText('Same title')).toHaveLength(2);
    expect(screen.getByText('invalid JSON')).toBeTruthy();
    update(featureError, undefined, 'F002');
    expect(container.querySelector('time')?.dateTime).toBe(snapshot.generatedAt);
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true');

    const partial: FeatureBoardResult = {
      ...snapshot,
      generatedAt: '2026-11-27T10:00:00Z',
      sessions: { ...snapshot.sessions, state: 'partial', errors: ['broken manifest'] },
    };
    update(partial);
    expect(screen.getByText(/Previous snapshot is stale/)).toBeTruthy();
    expect(container.querySelector('time')?.dateTime).toBe(snapshot.generatedAt);
    update(partial, 'offline');
    expect(container.querySelector('time')?.dateTime).toBe(snapshot.generatedAt);
    expect(screen.getByText('offline')).toBeTruthy();
    update({
      ...snapshot,
      generatedAt: '2026-11-27T11:00:00Z',
      sessions: { state: 'error', items: [], errors: ['permission denied'] },
    });
    expect(container.querySelector('time')?.dateTime).toBe(snapshot.generatedAt);

    const recovered = { ...snapshot, generatedAt: '2026-11-27T12:00:00Z' };
    update(recovered);
    expect(screen.queryByText(/Previous snapshot is stale/)).toBeNull();
    expect(container.querySelector('time')?.dateTime).toBe(recovered.generatedAt);
    update(featureError);
    expect(container.querySelector('time')?.dateTime).toBe(recovered.generatedAt);
  });

  it('首次来源失败不把诊断生成时间当作成功时间', () => {
    const { container } = show({
      snapshot: {
        ...snapshot,
        features: { state: 'error', items: [], errors: ['invalid JSON'] },
      },
    });
    expect(screen.getByText(/No fully successful snapshot in this view\./)).toBeTruthy();
    expect(container.querySelector('time')).toBeNull();
    expect(screen.queryByText(/Previous snapshot is stale/)).toBeNull();
    expect(screen.getByText('Feature source unavailable')).toBeTruthy();
  });

  it('读取期间防重复，300ms显示占位，2s显示操作说明，不冒充空数据', () => {
    vi.useFakeTimers();
    show({ snapshot: undefined, isLoading: true, isFetching: true });
    expect(
      screen.getByRole('button', { name: 'Refresh delivery snapshot' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => vi.advanceTimersByTime(299));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe(
      'Reading delivery snapshot…',
    );
    act(() => vi.advanceTimersByTime(1_700));
    expect(screen.getByRole('status').textContent).toContain('Reading delivery snapshot');
    expect(screen.queryByText('No registered Features.')).toBeNull();
  });

  it('Session 来源不可读不显示虚假空会话', () => {
    show({
      snapshot: {
        ...snapshot,
        sessions: { state: 'error', items: [], errors: ['permission denied'] },
      },
    });
    expect(screen.getByText('Session source unavailable')).toBeTruthy();
    expect(screen.getByText('permission denied')).toBeTruthy();
    expect(screen.queryByText('No Sessions.')).toBeNull();
    expect(screen.queryByText('No explicitly linked Sessions.')).toBeNull();
  });

  it('首次请求失败不显示成功计数或快照时间，仍可重试', () => {
    const onRefresh = vi.fn();
    show({ snapshot: undefined, error: 'offline', onRefresh });
    expect(screen.getByText('Delivery snapshot unavailable')).toBeTruthy();
    expect(screen.queryByText('Snapshot time')).toBeNull();
    expect(screen.queryByText('No registered Features.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh delivery snapshot' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('长标题和证据保留全文，刷新不丢失筛选，Feature 聚焦不隐藏独立会话', () => {
    const longRecord = '<script>alert(1)</script>' + '长内容/abcdefghijklmnop'.repeat(100);
    const data = {
      ...snapshot,
      features: {
        ...snapshot.features,
        items: snapshot.features.items.map((feature) => ({
          ...feature,
          title: feature.id === 'F002' ? longRecord : feature.title,
          evidence: [longRecord],
        })),
      },
    };
    const onFocus = vi.fn();
    const { rerender, container } = show({ snapshot: data, featureId: 'F002', onFocus });
    expect(container.querySelectorAll('details[data-feature]').length).toBe(1);
    expect(screen.getAllByText(longRecord).length).toBe(2);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Unbound goal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^In progress/ }));
    rerender(
      <I18nProvider initialLanguage="en">
        <FeatureBoard
          snapshot={data}
          featureId="F002"
          isLoading={false}
          isFetching={true}
          onRefresh={vi.fn()}
          onFocus={onFocus}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: /^In progress/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getAllByText(longRecord).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Feature focus' }));
    expect(onFocus).toHaveBeenCalledWith();
  });

  it('支持中文并保留技术标识与来源原文', () => {
    show({}, 'zh-CN');
    expect(screen.getByRole('heading', { name: 'Feature 交付' })).toBeTruthy();
    expect(screen.getByText('等待设计检查')).toBeTruthy();
    expect(screen.getByText('F999')).toBeTruthy();
  });
});
