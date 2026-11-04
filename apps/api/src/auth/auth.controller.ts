import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type AuthUser,
  type LoginInput,
  type RegisterInput,
} from '@taskflow/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { Env } from '../config/env';
import type { AuthSession } from './auth.service';
import { AuthService } from './auth.service';
import type { AccessTokenPayload } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { extractBearerToken } from './jwt-auth.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { Public } from './public.decorator';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';

/**
 * Exposes register, login, refresh, logout and current-user endpoints.
 * @since REQ-002
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookiePath: string;
  private readonly cookieSecure: boolean;

  /**
   * Reads the refresh cookie settings from config.
   * @since REQ-002
   */
  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.cookiePath = config.get('REFRESH_COOKIE_PATH');
    this.cookieSecure = config.get('NODE_ENV') === 'production';
  }

  /**
   * Creates an account, returns an access token and sets the refresh cookie. Rate limited per IP.
   * @since REQ-002
   * @updated REQ-005
   */
  @Public()
  @RateLimit('auth')
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Account created and signed in' })
  @ApiConflictResponse({ description: 'Email already registered' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.register(body));
  }

  /**
   * Signs in with email and password, returns an access token and sets the refresh cookie. Rate limited per IP.
   * @since REQ-002
   * @updated REQ-005
   */
  @Public()
  @RateLimit('auth')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Signed in' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.login(body));
  }

  /**
   * Rotates the refresh cookie and returns a new access token; clears the cookie when it is invalid. Rate limited per IP.
   * @since REQ-002
   * @updated REQ-005
   */
  @Public()
  @RateLimit('auth')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOkResponse({ description: 'Session renewed' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired, revoked or reused refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    try {
      return this.respond(res, await this.auth.refresh(readRefreshCookie(req) ?? ''));
    } catch (error) {
      clearRefreshCookie(res, this.cookiePath, this.cookieSecure);
      throw error;
    }
  }

  /**
   * Ends the session: revokes the refresh token family, denylists the access token and clears the cookie.
   * @since REQ-002
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiNoContentResponse({ description: 'Signed out' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req), extractBearerToken(req));
    clearRefreshCookie(res, this.cookiePath, this.cookieSecure);
  }

  /**
   * Returns the profile of the signed-in user.
   * @since REQ-002
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Current user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  me(@CurrentUser() user: AccessTokenPayload): Promise<AuthUser> {
    return this.auth.me(user.sub);
  }

  /**
   * Sets the refresh cookie and returns the public part of the session.
   * @since REQ-002
   */
  private respond(res: Response, { refreshToken, ...body }: AuthSession): AuthResponse {
    setRefreshCookie(res, refreshToken, this.cookiePath, this.cookieSecure);
    return body;
  }
}
