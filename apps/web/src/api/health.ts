import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@taskflow/shared';

/**
 * Fetches the API health status, returning the body for both 200 and 503 responses.
 * @since REQ-001
 */
export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok && res.status !== 503) throw new Error(`Health check failed: HTTP ${res.status}`);
  return (await res.json()) as HealthResponse;
}

/**
 * Polls the API health status every 10 seconds.
 * @since REQ-001
 */
export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 10_000 });
}
