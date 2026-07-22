import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { durationToMilliseconds, type EnvironmentConfig } from '@ai-content-os/config';
import type { AuthUser, LoginResponse, SessionSummary } from '@ai-content-os/contracts';
import type { Response } from 'express';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth/auth.types';
import {
  AllowPasswordChangeRequired,
  CurrentUser,
  Public,
} from '../../common/decorators/auth.decorators';
import { AuthService, type AuthResult } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('authentication')
@ApiBearerAuth()
@ApiCookieAuth('refreshCookie')
@AllowPasswordChangeRequired()
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ouvrir une session' })
  async login(
    @Body() body: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(body.email, body.password, request);
    this.setRefreshCookie(response, result.refreshToken);
    return this.publicResult(result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Faire tourner le jeton de rafraîchissement HttpOnly' })
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.refresh(this.readRefreshCookie(request), request);
    this.setRefreshCookie(response, result.refreshToken);
    return this.publicResult(result);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthContext,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(user, request);
    this.clearRefreshCookie(response);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: AuthContext,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user, request);
    this.clearRefreshCookie(response);
  }

  @Get('me')
  me(@CurrentUser() user: AuthContext): Promise<AuthUser> {
    return this.auth.me(user.userId);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthContext): Promise<SessionSummary[]> {
    return this.auth.sessions(user);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: AuthContext,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const revokedCurrent = await this.auth.revokeSession(user, sessionId, request);
    if (revokedCurrent) this.clearRefreshCookie(response);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthContext,
    @Body() body: ChangePasswordDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, request);
  }

  private publicResult(result: AuthResult): LoginResponse {
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
  }

  private readRefreshCookie(request: AuthenticatedRequest): string | undefined {
    const cookies = (request as AuthenticatedRequest & { cookies?: unknown }).cookies;
    if (!cookies || typeof cookies !== 'object') return undefined;
    const value = (cookies as Record<string, unknown>)[
      this.config.get('AUTH_COOKIE_NAME', { infer: true })
    ];
    return typeof value === 'string' ? value : undefined;
  }

  private setRefreshCookie(response: Response, value: string): void {
    response.cookie(this.config.get('AUTH_COOKIE_NAME', { infer: true }), value, {
      httpOnly: true,
      secure: this.config.get('AUTH_COOKIE_SECURE', { infer: true }),
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: durationToMilliseconds(this.config.get('REFRESH_TOKEN_TTL', { infer: true })),
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(this.config.get('AUTH_COOKIE_NAME', { infer: true }), {
      httpOnly: true,
      secure: this.config.get('AUTH_COOKIE_SECURE', { infer: true }),
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  }
}
