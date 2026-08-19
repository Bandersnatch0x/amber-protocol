import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.fn((opts) => opts);
const httpBatchLink = vi.fn((opts) => ({ type: 'httpBatchLink', opts }));

vi.mock('@trpc/react-query', () => ({
  createTRPCReact: () => ({ createClient }),
}));

vi.mock('@trpc/client', () => ({
  httpBatchLink,
}));

vi.mock('superjson', () => ({
  default: { marker: 'superjson' },
}));

describe('getTRPCClient', () => {
  beforeEach(() => {
    createClient.mockClear();
    httpBatchLink.mockClear();
  });

  it('configures the transformer on the tRPC client', async () => {
    const { getTRPCClient } = await import('@/lib/trpc');
    const superjson = (await import('superjson')).default;

    getTRPCClient();

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ transformer: superjson }));
    expect(httpBatchLink).toHaveBeenCalledWith(
      expect.not.objectContaining({ transformer: expect.anything() }),
    );
  });
});
