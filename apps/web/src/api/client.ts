import type { ApiError, AuthResponse } from '@taskflow/shared';

let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse | null> | null = null;
let onSessionChange: (session: AuthResponse | null) => void = () => {};

/**
 * Error thrown for non-2xx API responses, carrying the parsed ApiError body.
 * @since REQ-002
 */
export class ApiRequestError extends Error {
  /**
   * Wraps the HTTP status and the error body returned by the API.
   * @since REQ-002
   */
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? `HTTP ${status}`);
  }
}

/**
 * Stores the current access token in memory (never in localStorage).
 * @since REQ-002
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Registers the callback notified whenever a silent refresh renews or ends the session.
 * @since REQ-002
 */
export function subscribeSession(listener: (session: AuthResponse | null) => void): void {
  onSessionChange = listener;
}

/**
 * Exchanges the refresh cookie for a new access token, sharing one request between concurrent callers.
 * @since REQ-002
 */
export function refreshAccessToken(): Promise<AuthResponse | null> {
  refreshInFlight ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then(async (res) => (res.ok ? ((await res.json()) as AuthResponse) : null))
    .catch(() => null)
    .then((session) => {
      setAccessToken(session?.accessToken ?? null);
      onSessionChange(session);
      return session;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * Calls the API under /api with the access token, refreshing once and retrying when it gets 401.
 * @since REQ-002
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });

  if (res.status === 401 && retry && accessToken) {
    const session = await refreshAccessToken();
    if (session) return apiFetch<T>(path, init, false);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
