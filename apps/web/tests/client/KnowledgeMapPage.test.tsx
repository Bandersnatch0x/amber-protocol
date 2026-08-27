// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeMapPage } from '@/features/knowledge/KnowledgeMapPage';
import { I18nProvider } from '@/lib/i18n';
import type { KnowledgeGraphDTO, SemanticResultDTO } from '@/lib/knowledge-dto';

const trpcMocks = vi.hoisted(() => ({
  graphRefetch: vi.fn(),
  graphUseQuery: vi.fn(),
  recentRefetch: vi.fn(),
  recentUseQuery: vi.fn(),
  semanticRefetch: vi.fn(),
  semanticStatusUseQuery: vi.fn(),
  semanticUseQuery: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    knowledge: {
      graph: { useQuery: trpcMocks.graphUseQuery },
      recentChanges: { useQuery: trpcMocks.recentUseQuery },
      semanticStatus: { useQuery: trpcMocks.semanticStatusUseQuery },
      semantic: { useQuery: trpcMocks.semanticUseQuery },
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
    ReactFlow: ({
      children,
      edges = [],
      nodes = [],
      onNodeClick,
    }: {
      children?: ReactNode;
      edges?: Array<{ id: string; style?: { strokeDasharray?: string } }>;
      nodes?: Array<{ id: string }>;
      onNodeClick?: (event: unknown, node: { id: string }) => void;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'react-flow' },
        ...nodes.map((node) =>
          React.createElement(
            'button',
            {
              key: node.id,
              type: 'button',
              'data-testid': `flow-node-${node.id}`,
              onClick: () => onNodeClick?.({}, node),
            },
            node.id,
          ),
        ),
        ...edges.map((edge) =>
          React.createElement('span', {
            key: edge.id,
            'data-testid': `flow-edge-${edge.id}`,
            'data-stroke-dasharray': edge.style?.strokeDasharray ?? '',
          }),
        ),
        children,
      ),
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
      body: 'Feature body.',
    },
    {
      id: 'adr:0001',
      kind: 'adr',
      layer: 'decision',
      title: 'Test ADR',
      sourcePath: 'docs/adr/0001-test.md',
      body: 'Some body text.',
    },
  ],
  edges: [],
  drift: [],
  recentChanges: [],
};

const inferredEdge = {
  src: 'adr:0001',
  dst: 'feature:F059',
  verb: 'describes' as const,
  origin: 'inferred' as const,
  provenance: {
    provider: 'stub',
    model: 'stub-model',
    timestamp: '2026-08-28T00:00:00.000Z',
    promptHash: 'a'.repeat(64),
  },
};

const inferredSummary = {
  nodeId: 'adr:0001',
  summary: 'A stub summary for testing.',
  provenance: {
    provider: 'stub',
    model: 'stub-model',
    timestamp: '2026-08-28T00:00:00.000Z',
    promptHash: 'b'.repeat(64),
  },
  origin: 'inferred' as const,
};

function semanticStatus(available = false) {
  return {
    data: available
      ? { available: true, provider: 'stub', model: 'stub-model' }
      : { available: false, reason: 'not-configured' },
    isLoading: false,
    error: null,
  };
}

function semanticResult(result?: Partial<SemanticResultDTO>) {
  return {
    data: {
      available: true,
      inferredEdges: [],
      nodeSummaries: [],
      ...result,
    } satisfies SemanticResultDTO,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: trpcMocks.semanticRefetch,
  };
}

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
  trpcMocks.semanticStatusUseQuery.mockReturnValue(semanticStatus(false));
  trpcMocks.semanticUseQuery.mockReturnValue(semanticResult({ available: false }));
});

afterEach(cleanup);

function renderPage(language: 'en' | 'zh-CN' = 'en') {
  return render(
    <I18nProvider initialLanguage={language}>
      <KnowledgeMapPage />
    </I18nProvider>,
  );
}

describe('KnowledgeMapPage recent changes query', () => {
  it('uses explicit no-poll and no-retry options for the live recent feed', () => {
    renderPage();
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

describe('KnowledgeMapPage semantic consent', () => {
  it('keeps semantic inference disabled when the provider is unavailable', () => {
    renderPage();
    expect(screen.getByTestId('semantic-status-banner').textContent).toContain(
      'LLM provider not configured',
    );
    expect(trpcMocks.semanticUseQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false }),
    );
    expect(screen.getByTestId('recent-drift-panel')).toBeDefined();
  });

  it('does not enable semantic inference on page load when the provider is available', () => {
    trpcMocks.semanticStatusUseQuery.mockReturnValue(semanticStatus(true));
    renderPage();

    expect(trpcMocks.semanticUseQuery).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({
        enabled: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      }),
    );
    expect(screen.getByTestId('semantic-disclosure').textContent).toContain(
      'sends repository node identifiers, kinds, titles, excerpts, and existing edges',
    );
  });

  it('enables semantic inference only after the disclosure action is clicked', () => {
    trpcMocks.semanticStatusUseQuery.mockReturnValue(semanticStatus(true));
    renderPage();

    fireEvent.click(
      screen.getByRole('button', {
        name: /send repository titles and excerpts for semantic analysis/i,
      }),
    );
    expect(trpcMocks.semanticUseQuery).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ enabled: true }),
    );
  });
});

describe('KnowledgeMapPage semantic results and failures', () => {
  beforeEach(() => {
    trpcMocks.semanticStatusUseQuery.mockReturnValue(semanticStatus(true));
    trpcMocks.semanticUseQuery.mockImplementation((_input, options: { enabled?: boolean }) =>
      options.enabled
        ? semanticResult({
            inferredEdges: [inferredEdge],
            nodeSummaries: [inferredSummary],
            providerModel: 'stub-model',
          })
        : { ...semanticResult(), data: undefined },
    );
  });

  it('renders a real dashed inferred edge, badge, summary, and original provenance after consent', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /send repository titles and excerpts/i }));

    expect(screen.getByTestId('flow-edge-e0').getAttribute('data-stroke-dasharray')).toBe('6 4');
    fireEvent.click(screen.getByTestId('flow-node-adr:0001'));
    expect(screen.getByText(/inferred \(stub\/stub-model\)/i)).toBeDefined();
    expect(screen.getByTestId('inferred-summary').textContent).toContain(
      'A stub summary for testing.',
    );
    expect(screen.getByTestId('inferred-summary').textContent).toContain(
      'stub/stub-model · 2026-08-28',
    );
  });

  it('surfaces partial facade errors even when inferred edges exist', () => {
    trpcMocks.semanticUseQuery.mockImplementation((_input, options: { enabled?: boolean }) =>
      options.enabled
        ? semanticResult({ inferredEdges: [inferredEdge], error: 'node-summaries-unavailable' })
        : { ...semanticResult(), data: undefined },
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /send repository titles and excerpts/i }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('failed or was incomplete');
    expect(alert.className).toContain('border-red-300');
  });

  it('shows stable accessible errors for status and semantic transport failures', () => {
    trpcMocks.semanticStatusUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('secret status detail'),
    });
    const { rerender } = renderPage();
    expect(screen.getByRole('alert').textContent).toContain('status could not be loaded');
    expect(document.body.textContent).not.toContain('secret status detail');

    trpcMocks.semanticStatusUseQuery.mockReturnValue(semanticStatus(true));
    trpcMocks.semanticUseQuery.mockReturnValue({
      ...semanticResult(),
      error: new Error('secret semantic detail'),
    });
    rerender(
      <I18nProvider initialLanguage="en">
        <KnowledgeMapPage />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /send repository titles and excerpts/i }));
    expect(screen.getByRole('alert').textContent).toContain('failed or was incomplete');
    expect(document.body.textContent).not.toContain('secret semantic detail');
  });
});

describe('KnowledgeMapPage i18n', () => {
  it('renders provider-unavailable state in zh-CN', () => {
    renderPage('zh-CN');
    expect(screen.getByTestId('semantic-status-banner').textContent).toContain('未配置 LLM 提供者');
  });
});
