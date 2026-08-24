// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { SettingsProvider } from '@/lib/settings-provider';
import { Route } from '@/routes/gates';

// Flat-at-rest render coverage (DESIGN.md, "The Flat-By-Default Rule"): the
// two gate form controls — the reviewer input and the reject-reason textarea —
// must carry no resting shadow token, while their border, focus-ring, error,
// and dark-mode classes stay intact. GatesPage is mounted through module
// mocks of the router and the tRPC client so the route renders without a
// server or a generated route tree.

const trpcMocks = vi.hoisted(() => ({
  gates: [
    {
      gateId: 'gate-1',
      sessionId: 'session-1',
      type: 'user-approval',
      stage: 'verify',
      description: 'Approve the verification result',
      status: 'pending' as const,
      triggeredAt: '2025-01-01T00:00:00.000Z',
    },
  ],
}));

vi.mock('@tanstack/react-router', async () => {
  const { createElement } = await import('react');
  return {
    // gates.tsx only needs the registered component, the search state, and a
    // navigate callback; a hand-rolled route object covers all of them.
    createFileRoute:
      () =>
      (options: Record<string, unknown>): Record<string, unknown> => ({
        options,
        fullPath: '/gates',
        useSearch: () => ({}),
        useNavigate: () => () => undefined,
      }),
    Link: ({ children, className }: { children?: ReactNode; className?: string }) =>
      createElement('a', { href: '#', className }, children),
  };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useContext: () => ({
      gate: {
        auditSummary: {
          invalidate: () => Promise.resolve(),
        },
      },
    }),
    gate: {
      list: {
        useQuery: () => ({
          data: trpcMocks.gates,
          isLoading: false,
          error: null,
          refetch: () => Promise.resolve(),
        }),
      },
      auditSummary: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
      approveAndResume: {
        useMutation: () => ({ mutate: () => undefined, isLoading: false }),
      },
      reject: {
        useMutation: () => ({ mutate: () => undefined, isLoading: false }),
      },
    },
  },
}));

const GatesPage = Route.options.component as ComponentType;

function renderGatesPage(): void {
  render(
    <I18nProvider initialLanguage="en">
      <SettingsProvider>
        <GatesPage />
      </SettingsProvider>
    </I18nProvider>,
  );
}

/** Shadow tokens that are not state-scoped (focus:/hover:) — illegal at rest. */
function restingShadowTokens(element: HTMLElement): string[] {
  return Array.from(element.classList).filter(
    (token) =>
      token.includes('shadow') && !token.startsWith('focus:') && !token.startsWith('hover:'),
  );
}

function openReviewPanel(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  return screen.getByLabelText('Reviewer identifier (optional)');
}

function openRejectPanel(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  return screen.getByLabelText('Reject reason');
}

afterEach(() => {
  cleanup();
});

describe('gates route flat-at-rest inputs', () => {
  it('renders the reviewer input flat at rest with border, focus-ring, and dark-mode classes', () => {
    renderGatesPage();
    const reviewerInput = openReviewPanel();
    const tokens = Array.from(reviewerInput.classList);

    expect(restingShadowTokens(reviewerInput), `classes: ${tokens.join(' ')}`).toEqual([]);

    expect(tokens).toContain('border');
    expect(tokens).toContain('border-slate-300');
    expect(tokens).toContain('focus:outline-none');
    expect(tokens).toContain('focus:ring-2');
    expect(tokens).toContain('focus:ring-blue-500');
    expect(tokens).toContain('dark:border-slate-600');
    expect(tokens).toContain('dark:bg-slate-950');
    expect(tokens).toContain('dark:text-white');
  });

  it('renders the reject-reason textarea flat at rest with border, focus-ring, and dark-mode classes', () => {
    renderGatesPage();
    const rejectReason = openRejectPanel();
    const tokens = Array.from(rejectReason.classList);

    expect(restingShadowTokens(rejectReason), `classes: ${tokens.join(' ')}`).toEqual([]);

    expect(tokens).toContain('border');
    expect(tokens).toContain('border-red-200');
    expect(tokens).toContain('focus:outline-none');
    expect(tokens).toContain('focus:ring-2');
    expect(tokens).toContain('focus:ring-red-500');
    expect(tokens).toContain('dark:border-red-900/70');
    expect(tokens).toContain('dark:bg-slate-950');
    expect(tokens).toContain('dark:text-white');
  });

  it('keeps shadow-free error styling on both fields when validation flags them', () => {
    renderGatesPage();

    // Reviewer error: submit an invalid reviewer identifier.
    const reviewerInput = openReviewPanel();
    fireEvent.change(reviewerInput, { target: { value: 'not a valid id!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve and confirm resume' }));
    const reviewerTokens = Array.from(reviewerInput.classList);
    expect(restingShadowTokens(reviewerInput), `classes: ${reviewerTokens.join(' ')}`).toEqual([]);
    expect(reviewerTokens).toContain('border-2');
    expect(reviewerTokens).toContain('border-red-500');
    expect(reviewerTokens).toContain('focus:ring-red-500');

    // Reject-reason error: confirm a rejection with an empty reason.
    const rejectReason = openRejectPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
    const rejectTokens = Array.from(rejectReason.classList);
    expect(restingShadowTokens(rejectReason), `classes: ${rejectTokens.join(' ')}`).toEqual([]);
    expect(rejectTokens).toContain('border-2');
    expect(rejectTokens).toContain('border-red-500');
    expect(rejectTokens).toContain('focus:ring-red-500');
  });
});
