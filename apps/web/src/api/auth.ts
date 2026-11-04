import type { AuthResponse, AuthUser, LoginInput, RegisterInput } from '@taskflow/shared';
import { apiFetch } from './client';

/**
 * Creates an account and returns the new session.
 * @since REQ-002
 */
export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

/**
 * Signs in with email and password and returns the session.
 * @since REQ-002
 */
export function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

/**
 * Ends the session on the server and clears the refresh cookie.
 * @since REQ-002
 */
export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' }, false);
}

/**
 * Fetches the profile of the signed-in user.
 * @since REQ-002
 */
export function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/me');
}
