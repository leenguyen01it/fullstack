import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthUser, LoginInput, RegisterInput } from '@taskflow/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenService } from './access-token.service';
import type { IssuedRefreshToken } from './auth.types';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Describes everything a successful sign-in produces: the response body and the refresh token for the cookie.
 * @since REQ-002
 */
export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
  refreshToken: IssuedRefreshToken;
}

const USER_SELECT = { id: true, email: true, name: true, createdAt: true } as const;

/**
 * Registers users, signs them in and out, and renews their sessions.
 * @since REQ-002
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /**
   * Creates an account and signs it in; throws 409 when the email is already registered.
   * @since REQ-002
   */
  async register(input: RegisterInput): Promise<AuthSession> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: { email: input.email, name: input.name, passwordHash },
        select: USER_SELECT,
      });
      return this.startSession(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  /**
   * Signs in with email and password; throws 401 with the same message whether the email or the password is wrong.
   * @since REQ-002
   */
  async login(input: LoginInput): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = await this.passwords.verify(user?.passwordHash, input.password);
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');
    return this.startSession(user);
  }

  /**
   * Exchanges a refresh token for a new access token and a rotated refresh token.
   * @since REQ-002
   */
  async refresh(refreshToken: string): Promise<AuthSession> {
    const rotated = await this.refreshTokens.rotate(refreshToken);
    const user = await this.findProfile(rotated.userId);
    return {
      accessToken: await this.accessTokens.sign(user.id),
      expiresIn: this.accessTokens.ttlSeconds,
      user: toAuthUser(user),
      refreshToken: rotated.refreshToken,
    };
  }

  /**
   * Revokes the refresh token family and denylists the current access token when provided.
   * @since REQ-002
   */
  async logout(refreshToken: string | undefined, accessToken: string | undefined): Promise<void> {
    if (refreshToken) await this.refreshTokens.revoke(refreshToken);
    if (accessToken) {
      const payload = await this.accessTokens.verify(accessToken);
      if (payload) await this.accessTokens.revoke(payload);
    }
  }

  /**
   * Returns the public profile of a user; throws 401 when the user no longer exists.
   * @since REQ-002
   */
  async me(userId: string): Promise<AuthUser> {
    return toAuthUser(await this.findProfile(userId));
  }

  /**
   * Loads the profile columns of a user or throws 401.
   * @since REQ-002
   */
  private async findProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }

  /**
   * Issues a new access token and a refresh token in a new family for the user.
   * @since REQ-002
   */
  private async startSession(user: ProfileRow): Promise<AuthSession> {
    const [accessToken, refreshToken] = await Promise.all([
      this.accessTokens.sign(user.id),
      this.refreshTokens.issue(user.id),
    ]);
    return {
      accessToken,
      expiresIn: this.accessTokens.ttlSeconds,
      user: toAuthUser(user),
      refreshToken,
    };
  }
}

/**
 * Describes the user columns selected for profiles.
 * @since REQ-002
 */
type ProfileRow = { id: string; email: string; name: string; createdAt: Date };

/**
 * Converts a user row into the shared AuthUser shape.
 * @since REQ-002
 */
function toAuthUser(user: ProfileRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}
