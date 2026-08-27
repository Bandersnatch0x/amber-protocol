// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
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

function defaultSemanticStatusResult(available = false) {
  return {
    data: { available, provider: available ? 'openai' : undefined, model: available ? 'gpt-4o' : undefined },
    isLoading: false,
    error: null,
  };
}

function defaultSemanticResult(result?: Partial<SemanticResultDTO>) {
  return {
    data: {
      available: false,
      inferredEdges: [],
      nodeSummaries: [],
      ...result,
    } satisfies SemanticResultDTO,
    isLoading: false,
    error: null,
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
  trpcMocks.semanticStatusUseQuery.mockReturnValue(defaultSemanticStatusResult(false));
  trpcMocks.semanticUseQuery.mockReturnValue(defaultSemanticResult());
});

afterEach(() => {
  cleanup();
});

function renderPage(lang: 'en' | 'zh-CN' = 'en') {
  return render(
    <I18nProvider initialLanguage={lang}>
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

describe('KnowledgeMapPage semantic — provider unavailable', () => {
  it('shows "provider not configured" banner when LLM status is available:false', () => {
    renderPage();
    const banner = screen.getByTestId('semantic-status-banner');
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain('LLM provider not configured');
  });

  it('still renders the deterministic graph (recent-drift panel visible)', () => {
    renderPage();
    expect(screen.getByTestId('recent-drift-panel')).toBeDefined();
  });

  it('semantic query is NOT enabled when provider is unavailable', () => {
    renderPage();
    expect(trpcMocks.semanticUseQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false }),
    );
  });
});

describe('KnowledgeMapPage semantic — provider available, stub inferred edges', () => {
  const inferredEdge = {
    src: 'adr:0001',
    dst: 'feature:F059',
    verb: 'describes' as const,
    origin: 'inferred' as const,
    provenance: { model: 'stub-model', timestamp: '2026-08-28T00:00:00.000Z', promptHash: 'abc123' },
  };

  const inferredSummary = {
    nodeId: 'adr:0001',
    summary: 'A stub summary for testing.',
    provenance: { model: 'stub-model', timestamp: '2026-08-28T00:00:00.000Z', promptHash: 'def456' },
    origin: 'inferred' as const,
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
    trpcMocks.semanticStatusUseQuery.mockReturnValue(defaultSemanticStatusResult(true));
    trpcMocks.semanticUseQuery.mockReturnValue(
      defaultSemanticResult({
        available: true,
        inferredEdges: [inferredEdge],
        nodeSummaries: [inferredSummary],
        providerModel: 'stub-model',
      }),
    );
  });

  it('semantic query is enabled when provider is available', () => {
    renderPage();
    expect(trpcMocks.semanticUseQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: true }),
    );
  });

  it('no provider-unavailable banner when LLM is available', () => {
    renderPage();
    const banner = screen.queryByTestId('semantic-status-banner');
    // Banner may not be present when provider is available and no error
    if (banner) {
      expect(banner.textContent).not.toContain('not configured');
    }
  });

  it('legend shows dashed line indicator for inferred edges', () => {
    renderPage();
    // The dashed line is rendered as a span with border-dashed class in the legend
    const legendDashed = document.querySelector('.border-dashed');
    expect(legendDashed).not.toBeNull();
  });

  it('showInferred checkbox is present in the page controls', () => {
    renderPage();
    const checkbox = screen.getByRole('checkbox', { name: /inferred edges/i });
    expect(checkbox).toBeDefined();
  });
});

describe('KnowledgeMapPage i18n — zh-CN', () => {
  it('renders semantic.unavailable banner in Chinese when provider is absent', () => {
    trpcMocks.semanticStatusUseQuery.mockReturnValue(defaultSemanticStatusResult(false));
    renderPage('zh-CN');
    const banner = screen.getByTestId('semantic-status-banner');
    expect(banner.textContent).toContain('未配置 LLM 提供者');
  });
});
