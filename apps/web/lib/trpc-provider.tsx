'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, getTRPCClient } from './trpc';
import { useState } from 'react';

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,      // 5 minutes
        cacheTime: 10 * 60 * 1000,     // 10 minutes
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));
  const [trpcClient] = useState(() => getTRPCClient());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
