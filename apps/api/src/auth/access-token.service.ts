import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import { RedisService } from '../redis/redis.service';
import type { AccessTokenPayload } from './auth.types';

const ISSUER = 'taskflow-api';
const AUDIENCE = 'taskflow-web';
const DENYLIST_PREFIX = 'auth:denylist:';

/**
 * Signs and verifies short-lived JWT access tokens and keeps a Redis denylist of logged-out tokens.
 * @since REQ-002
 */
@Injectable()
export class AccessTokenService {
  readonly ttlSeconds: number;

  /**
   * Reads the access token lifetime from config.
   * @since REQ-002
   */
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('JWT_ACCESS_TTL_SECONDS');
  }

  /**
   * Issues a signed HS256 access token for the given user.
   * @since REQ-002
   */
  sign(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId },
      {
        jwtid: randomUUID(),
        expiresIn: this.ttlSeconds,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  /**
   * Returns the claims of a valid, non-denylisted access token, or null otherwise.
   * @since REQ-002
   */
  async verify(token: string): Promise<AccessTokenPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (await this.isDenylisted(payload.jti)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Denylists an access token until its natural expiry so it is rejected after logout.
   * @since REQ-002
   */
  async revoke(payload: AccessTokenPayload): Promise<void> {
    const ttl = payload.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) await this.redis.client.set(DENYLIST_PREFIX + payload.jti, '1', 'EX', ttl);
  }

  /**
   * Returns true when the token id is on the denylist.
   * @since REQ-002
   */
  private async isDenylisted(jti: string): Promise<boolean> {
    return (await this.redis.client.exists(DENYLIST_PREFIX + jti)) === 1;
  }
}
