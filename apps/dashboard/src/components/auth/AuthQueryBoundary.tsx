import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';

let nextScope = 0;

function QueryScope({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  }));
  useEffect(() => () => {
    void client.cancelQueries();
    client.clear();
  }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** New auth sessions cannot render the preceding session's cache or page state. */
export function AuthQueryBoundary({ children }: { children: ReactNode }) {
  const generation = useAuthStore(state => state.sessionGeneration);
  const token = useAuthStore(state => state.token);
  // Include token for persisted-store hydration; never use a credential as a key.
  const scope = useMemo(() => ++nextScope, [generation, token]);
  return <QueryScope key={scope}>{children}</QueryScope>;
}
