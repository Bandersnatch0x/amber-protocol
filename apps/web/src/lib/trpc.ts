import { httpBatchLink, httpLink, splitLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';
import type { AppRouter } from '@server/app-router';

export const trpc = createTRPCReact<AppRouter>();

function getBaseUrl() {
  return import.meta.env.VITE_API_URL ?? '';
}

export function getTRPCClient() {
  return trpc.createClient({
    links: [
      splitLink({
        condition: (operation) => operation.path === 'continuity.governance.board',
        true: httpLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          fetch: (input, init) => {
            const timeout = AbortSignal.timeout(10_000);
            const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
            return fetch(input, { ...init, signal });
          },
        }),
        false: httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      }),
    ],
  });
}
