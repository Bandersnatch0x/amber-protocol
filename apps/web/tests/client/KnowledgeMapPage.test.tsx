// @vitest-environment happy-dom
import { skipToken } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeMapPage } from '@/features/knowledge/KnowledgeMapPage';
import { I18nProvider } from '@/lib/i18n';
import type { KnowledgeGraphDTO, SemanticResultDTO } from '@/lib/knowledge-dto';
import { MAX_CONTEXT_NODES } from '@/lib/knowledge-dto';

const trpcMocks = vi.hoisted(() => ({
  graphRefetch: vi.fn(),
  graphUseQuery: vi.fn(),
  recentRefetch: vi.fn(),
  recentUseQuery: vi.fn(),
  semanticRefetch: vi.fn(),
  semanticStatusUseQuery: vi.fn(),
  semanticUseQuery: vi.fn(),
  askRefetch: vi.fn(),
  askUseQuery: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    knowledge: {
      graph: { useQuery: trpcMocks.graphUseQuery },
      recentChanges: { useQuery: trpcMocks.recentUseQuery },
      semanticStatus: { useQuery: trpcMocks.semanticStatusUseQuery },
      semantic: { useQuery: trpcMocks.semanticUseQuery },
      ask: { useQuery: trpcMocks.askUseQuery },
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
      nodes?: Array<{ id: string; data?: { selected?: boolean } }>;
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
              'data-selected': String(node.data?.selected === true),
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
    {
      id: 'wiki:current',
      kind: 'wiki',
      layer: 'knowledge',
      title: 'Current guidance',
      sourcePath: 'docs/wiki/current.md',
      body: 'Current guidance body.',
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

type AskInput = { question: string; focusNodeId?: string; allowExternal: true };

function askResult(input: AskInput | typeof skipToken) {
  const request = input === skipToken ? null : input;
  return {
    data: request
      ? {
          status: 'ok' as const,
          answer: {
            segments: [
              {
                text: 'F059 is governed by ADR-0001.',
                citations: ['feature:F059', 'adr:0001'],
              },
            ],
          },
          omittedCount: 2,
          supersededBy: {},
          request: {
            question: request.question,
            ...(request.focusNodeId ? { focusNodeId: request.focusNodeId } : {}),
          },
          contextDigest: 'c'.repeat(64),
          questionDigest: 'e'.repeat(64),
          exchangeDigest: 'f'.repeat(64),
          provenance: {
            provider: 'stub',
            model: 'stub-model',
            timestamp: '2026-08-28T00:00:00.000Z',
            promptHash: 'd'.repeat(64),
          },
        }
      : undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: trpcMocks.askRefetch,
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
  trpcMocks.askUseQuery.mockImplementation((input) => askResult(input));
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

describe('KnowledgeMapPage cited QA', () => {
  it('submits only after disclosure and keeps answer scope truthful during citation navigation', () => {
    renderPage();
    expect(trpcMocks.askUseQuery).toHaveBeenLastCalledWith(
      skipToken,
      expect.objectContaining({
        retry: false,
        refetchInterval: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        gcTime: 0,
      }),
    );

    fireEvent.click(screen.getByTestId('flow-node-feature:F059'));
    const detailButton = screen.getByRole('button', { name: 'Detail' });
    const askButton = screen.getByRole('button', { name: 'Ask' });
    expect(detailButton.getAttribute('aria-pressed')).toBe('true');
    expect(askButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(askButton);
    expect(detailButton.getAttribute('aria-pressed')).toBe('false');
    expect(askButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(
      screen.getByText(/sends your question and deterministic repository context/i),
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'What governs F059?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));

    expect(trpcMocks.askUseQuery).toHaveBeenLastCalledWith(
      {
        question: 'What governs F059?',
        focusNodeId: 'feature:F059',
        allowExternal: true,
      },
      expect.objectContaining({ retry: false, gcTime: 0 }),
    );
    expect(screen.getByTestId('knowledge-ask-answer').textContent).toContain(
      'F059 is governed by ADR-0001.',
    );
    expect(screen.getByTestId('knowledge-ask-submitted-question').textContent).toContain(
      'What governs F059?',
    );
    expect(screen.getByTestId('knowledge-ask-submitted-focus').textContent).toContain(
      'feature:F059',
    );
    expect(screen.getByText('2 uncited claims omitted')).toBeDefined();

    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'A different draft' } });
    fireEvent.click(screen.getByTestId('knowledge-citation-adr:0001'));
    expect(screen.getByTestId('flow-node-adr:0001').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('knowledge-ask-submitted-question').textContent).toContain(
      'What governs F059?',
    );
    expect(screen.getByTestId('knowledge-ask-submitted-question').textContent).not.toContain(
      'A different draft',
    );
    expect(screen.getByTestId('knowledge-ask-submitted-focus').textContent).toContain(
      'feature:F059',
    );
    expect(screen.getByTestId('knowledge-ask-panel')).toBeDefined();
  });

  it('marks superseded citations and links every deterministic superseder in stable order', () => {
    trpcMocks.graphUseQuery.mockReturnValue({
      data: {
        ...graph,
        edges: [
          {
            src: 'wiki:current',
            dst: 'feature:F059',
            verb: 'supersedes',
            origin: 'deterministic',
          },
          {
            src: 'adr:0001',
            dst: 'feature:F059',
            verb: 'supersedes',
            origin: 'deterministic',
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: trpcMocks.graphRefetch,
    });
    trpcMocks.askUseQuery.mockImplementation((input) => {
      const result = askResult(input);
      if (result.data?.status === 'ok') {
        result.data.supersededBy = { 'feature:F059': ['adr:0001', 'wiki:current'] };
      }
      return result;
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What changed?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));

    expect(screen.getByText('superseded')).toBeDefined();
    const supersederButtons = screen.getAllByRole('button', { name: /^current:/ });
    expect(supersederButtons.map((button) => button.textContent)).toEqual([
      'current: adr:0001',
      'current: wiki:current',
    ]);
    fireEvent.click(supersederButtons[0]);
    expect(screen.getByTestId('flow-node-adr:0001').getAttribute('data-selected')).toBe('true');
    fireEvent.click(supersederButtons[1]);
    expect(screen.getByTestId('flow-node-wiki:current').getAttribute('data-selected')).toBe('true');
  });

  it('renders stable errors without provider details', () => {
    trpcMocks.askUseQuery.mockImplementation((input) => ({
      ...askResult(skipToken),
      error: input === skipToken ? null : new Error('secret provider detail'),
    }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));

    expect(screen.getByRole('alert').textContent).toContain('could not be generated');
    expect(document.body.textContent).not.toContain('secret provider detail');
    expect(screen.getByTestId('react-flow')).toBeDefined();
  });

  it('renders unavailable and loading states without hiding the map', () => {
    trpcMocks.askUseQuery.mockImplementation((input) => ({
      ...askResult(skipToken),
      data:
        input === skipToken
          ? undefined
          : { status: 'unavailable' as const, reason: 'not-configured' as const },
    }));
    const { rerender } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    expect(
      screen.getByText('Ask is unavailable because no LLM provider is configured.'),
    ).toBeDefined();

    trpcMocks.askUseQuery.mockImplementation((input) => ({
      ...askResult(skipToken),
      isFetching: input !== skipToken,
    }));
    rerender(
      <I18nProvider initialLanguage="en">
        <KnowledgeMapPage />
      </I18nProvider>,
    );
    expect((screen.getByRole('button', { name: 'Asking…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('react-flow')).toBeDefined();
  });
});

describe('KnowledgeMapPage Ask context ceiling', () => {
  function oversizedGraph(): KnowledgeGraphDTO {
    const nodes = Array.from({ length: MAX_CONTEXT_NODES + 1 }, (_, index) => ({
      id: `feature:F${index}`,
      kind: 'feature' as const,
      layer: 'implementation' as const,
      title: `Feature ${index}`,
      sourcePath: 'feature_list.json',
    }));
    return { ...graph, nodes };
  }

  beforeEach(() => {
    trpcMocks.graphUseQuery.mockReturnValue({
      data: oversizedGraph(),
      isLoading: false,
      error: null,
      refetch: trpcMocks.graphRefetch,
    });
  });

  it('warns before submission when an unfocused question would overflow the context', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(screen.getByText(/past the 256-node context ceiling/)).toBeDefined();
  });

  it('replaces the warning with the focus hint once a node is selected', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('flow-node-feature:F0'));
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(screen.queryByText(/past the 256-node context ceiling/)).toBeNull();
    expect(screen.getByText(/Focused on feature:F0/)).toBeDefined();
  });
});

describe('KnowledgeMapPage i18n', () => {
  it('renders provider-unavailable state in zh-CN', () => {
    renderPage('zh-CN');
    expect(screen.getByTestId('semantic-status-banner').textContent).toContain('未配置 LLM 提供者');
  });

  it('renders the Ask disclosure and controls in zh-CN', () => {
    renderPage('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(screen.getByText('向知识地图提问')).toBeDefined();
    expect(screen.getByText(/确定性仓库上下文/)).toBeDefined();
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDefined();
  });
});
