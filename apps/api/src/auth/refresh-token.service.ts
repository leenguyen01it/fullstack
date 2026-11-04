import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { IssuedRefreshToken } from './auth.types';

const REUSE_GRACE_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Issues, rotates and revokes opaque refresh tokens, revoking the whole family when a rotated token is reused.
 * @since REQ-002
 */
@Injectable()
export class RefreshTokenService {
  private readonly ttlMs: number;

  /**
   * Reads the refresh token lifetime from config.
   * @since REQ-002
   */
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('REFRESH_TOKEN_TTL_DAYS') * DAY_MS;
  }

  /**
   * Creates a refresh token for the user, starting a new family unless one is given.
   * @since REQ-002
   */
  async issue(userId: string, familyId: string = randomUUID()): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.prisma.refreshToken.create({
      data: { userId, familyId, tokenHash: this.hash(token), expiresAt },
    });
    return { token, expiresAt };
  }

  /**
   * Consumes a refresh token and returns its user with a new token in the same family.
   * Throws 401 when the token is unknown, expired, revoked or already rotated.
   * @since REQ-002
   */
  async rotate(token: string): Promise<{ userId: string; refreshToken: IssuedRefreshToken }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!record || record.revokedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.rotatedAt) {
      if (Date.now() - record.rotatedAt.getTime() > REUSE_GRACE_MS) {
        await this.revokeFamily(record.familyId);
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count !== 1) throw new UnauthorizedException('Invalid refresh token');

    const refreshToken = await this.issue(record.userId, record.familyId);
    return { userId: record.userId, refreshToken };
  }

  /**
   * Revokes every token in the family of the given refresh token; unknown tokens are ignored.
   * @since REQ-002
   */
  async revoke(token: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(token) },
      select: { familyId: true },
    });
    if (record) await this.revokeFamily(record.familyId);
  }

  /**
   * Marks every still-active token of a family as revoked.
   * @since REQ-002
   */
  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Returns the SHA-256 hex digest stored in place of the raw token.
   * @since REQ-002
   */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
