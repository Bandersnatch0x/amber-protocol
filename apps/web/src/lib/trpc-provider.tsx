import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, getTRPCClient } from './trpc';
import { useEffect, useState } from 'react';
import { useSettings } from './settings-provider';

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
        refetchInterval: settings.autoRefresh ? settings.refreshInterval * 1000 : false,
      },
    },
  }));
  const [trpcClient] = useState(() => getTRPCClient());

  useEffect(() => {
    queryClient.setDefaultOptions({
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
        refetchInterval: settings.autoRefresh ? settings.refreshInterval * 1000 : false,
      },
    });
  }, [settings.autoRefresh, settings.refreshInterval, queryClient]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
