// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeMapPage } from '@/features/knowledge/KnowledgeMapPage';
import { I18nProvider } from '@/lib/i18n';
import type { KnowledgeGraphDTO } from '@/lib/knowledge-dto';

const trpcMocks = vi.hoisted(() => ({
  graphRefetch: vi.fn(),
  graphUseQuery: vi.fn(),
  recentRefetch: vi.fn(),
  recentUseQuery: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    knowledge: {
      graph: { useQuery: trpcMocks.graphUseQuery },
      recentChanges: { useQuery: trpcMocks.recentUseQuery },
    },
  },
}));

vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to: string }) =>
      React.createElement('a', { href: to, ...props }, children),
  };
});

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'react-flow' }, children),
    ReactFlowProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useReactFlow: () => ({ fitView: () => undefined }),
  };
});

const graph: KnowledgeGraphDTO = {
  schemaVersion: '1',
  nodes: [
    {
      id: 'feature:F059',
      kind: 'feature',
      layer: 'implementation',
      title: 'Recent knowledge drift feed',
      sourcePath: 'feature_list.json',
    },
  ],
  edges: [],
  drift: [],
  recentChanges: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  trpcMocks.graphUseQuery.mockReturnValue({
    data: graph,
    isLoading: false,
    error: null,
    refetch: trpcMocks.graphRefetch,
  });
  trpcMocks.recentUseQuery.mockReturnValue({
    data: [],
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: trpcMocks.recentRefetch,
  });
});

afterEach(() => {
  cleanup();
});

describe('KnowledgeMapPage recent changes query', () => {
  it('uses explicit no-poll and no-retry options for the live recent feed', () => {
    render(
      <I18nProvider initialLanguage="en">
        <KnowledgeMapPage />
      </I18nProvider>,
    );

    expect(screen.getByTestId('recent-drift-panel')).toBeDefined();
    expect(trpcMocks.recentUseQuery).toHaveBeenCalledWith(undefined, {
      refetchInterval: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: Infinity,
    });
  });
});
