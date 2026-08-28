import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, getTRPCClient } from './trpc';
import { useEffect, useMemo, useState } from 'react';
import { useSettings } from './settings-provider';
import type { Settings } from '@/features/settings/settings-model';

function queryDefaults({
  autoRefresh,
  refreshInterval,
}: Pick<Settings, 'autoRefresh' | 'refreshInterval'>) {
  const refetchInterval: number | false = autoRefresh ? refreshInterval * 1000 : false;
  return {
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    refetchInterval,
  };
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const { autoRefresh, refreshInterval } = settings;

  const queries = useMemo(
    () => queryDefaults({ autoRefresh, refreshInterval }),
    [autoRefresh, refreshInterval],
  );

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries },
      }),
  );
  const [trpcClient] = useState(() => getTRPCClient());

  useEffect(() => {
    queryClient.setDefaultOptions({ queries });
  }, [queries, queryClient]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
