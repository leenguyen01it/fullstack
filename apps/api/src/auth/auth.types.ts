import type { Request } from 'express';

/**
 * Describes the verified claims carried by an access token.
 * @since REQ-002
 */
export interface AccessTokenPayload {
  sub: string;
  jti: string;
  exp: number;
}

/**
 * Describes an Express request that passed JwtAuthGuard.
 * @since REQ-002
 */
export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}

/**
 * Describes a freshly issued refresh token and when it expires.
 * @since REQ-002
 */
export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}
