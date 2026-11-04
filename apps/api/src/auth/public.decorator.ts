import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key that marks a route or controller as reachable without an access token.
 * @since REQ-002
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route or controller as public so JwtAuthGuard skips it.
 * @since REQ-002
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
