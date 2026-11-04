import type { CookieOptions, Request, Response } from 'express';
import type { IssuedRefreshToken } from './auth.types';

/**
 * Name of the HttpOnly cookie that carries the refresh token.
 * @since REQ-002
 */
export const REFRESH_COOKIE = 'tf_refresh';

/**
 * Builds the security attributes shared by setting and clearing the refresh cookie.
 * @since REQ-002
 */
function baseOptions(path: string, secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path };
}

/**
 * Sends the refresh token as an HttpOnly, SameSite=Strict cookie scoped to the auth routes.
 * @since REQ-002
 */
export function setRefreshCookie(
  res: Response,
  { token, expiresAt }: IssuedRefreshToken,
  path: string,
  secure: boolean,
): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions(path, secure), expires: expiresAt });
}

/**
 * Tells the browser to delete the refresh cookie.
 * @since REQ-002
 */
export function clearRefreshCookie(res: Response, path: string, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(path, secure));
}

/**
 * Returns the refresh token from the request cookies, if present.
 * @since REQ-002
 */
export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
