import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, getTRPCClient } from './trpc';
import { useEffect, useState } from 'react';
import { useSettings } from './settings-provider';
import type { Settings } from '@/features/settings/settings-model';

function queryDefaults({ autoRefresh, refreshInterval }: Pick<Settings, 'autoRefresh' | 'refreshInterval'>) {
  return {
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    refetchInterval: autoRefresh ? refreshInterval * 1000 : false,
  };
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const { autoRefresh, refreshInterval } = settings;

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: queryDefaults({ autoRefresh, refreshInterval }),
    },
  }));
  const [trpcClient] = useState(() => getTRPCClient());

  useEffect(() => {
    queryClient.setDefaultOptions({
      queries: queryDefaults({ autoRefresh, refreshInterval }),
    });
  }, [autoRefresh, refreshInterval, queryClient]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
