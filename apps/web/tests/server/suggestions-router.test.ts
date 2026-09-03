import { describe, it, expect, beforeEach, vi } from 'vitest';
import { suggestionsRouter } from '../../server/routers/suggestions';
import * as service from '../../server/lib/suggestions/service';

vi.mock('../../server/lib/suggestions/service', () => ({
  listSuggestions: vi.fn(),
  readSuggestion: vi.fn(),
  dismissSuggestion: vi.fn(),
  snoozeSuggestion: vi.fn(),
  applySuggestionById: vi.fn(),
  undoSuggestionById: vi.fn(),
}));

vi.mock('../../server/lib/repo-root', () => ({
  resolveRepoRoot: () => '/tmp/repo',
}));

const listSuggestions = service.listSuggestions as ReturnType<typeof vi.fn>;
const readSuggestion = service.readSuggestion as ReturnType<typeof vi.fn>;
const dismissSuggestion = service.dismissSuggestion as ReturnType<typeof vi.fn>;
const applySuggestionById = service.applySuggestionById as ReturnType<typeof vi.fn>;

const caller = suggestionsRouter.createCaller({});

describe('suggestionsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists clustered cards', async () => {
    const payload = { suggestions: [{ id: 'abc' }], scanned: [] };
    listSuggestions.mockReturnValue(payload);
    await expect(caller.list()).resolves.toBe(payload);
  });

  it('reads a card or throws', async () => {
    readSuggestion.mockReturnValue(null);
    await expect(caller.read({ id: 'missing' })).rejects.toThrow('Suggestion not found');
    readSuggestion.mockReturnValue({ id: 'abc' });
    await expect(caller.read({ id: 'abc' })).resolves.toEqual({ id: 'abc' });
  });

  it('unwraps mutation failures', async () => {
    dismissSuggestion.mockReturnValue({
      ok: false,
      code: 'not-found',
      message: 'Suggestion not found.',
    });
    await expect(caller.dismiss({ id: 'x' })).rejects.toThrow('not-found');
  });

  it('returns the applied card', async () => {
    applySuggestionById.mockReturnValue({ ok: true, suggestion: { id: 'abc', status: 'applied' } });
    await expect(caller.applyCard({ id: 'abc' })).resolves.toEqual({
      id: 'abc',
      status: 'applied',
    });
  });
});
