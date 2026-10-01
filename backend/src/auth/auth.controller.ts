import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { UserProfileService } from '../users/user-profile.service.js';
import { AuthService } from './auth.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AccessTokenGuard, AuthRequestGuard } from './auth.guards.js';
import type { AuthenticatedRequest } from './auth.guards.js';
import { parseCredentials } from './auth-input.js';
import { API_V1 } from '../config/api-version.js';

@Controller({ path: 'auth', version: API_V1 })
@UseGuards(AuthRequestGuard)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthRateLimitService) private readonly limits: AuthRateLimitService,
    @Inject(RefreshCookieService)
    private readonly cookies: RefreshCookieService,
    @Inject(UserProfileService) private readonly profiles: UserProfileService,
  ) {}

  @Post('register')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseCredentials(body, true);
    await this.limits.consume(`register:${input.email}`, 5, 900);
    return this.respond(
      await this.auth.register(
        input.email,
        input.password,
        input.dateOfBirth,
        input.nickname,
      ),
      response,
    );
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseCredentials(body);
    await this.limits.consume(`login:${input.email}`, 10, 900);
    return this.respond(
      await this.auth.login(input.email, input.password),
      response,
    );
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return this.respond(
        await this.auth.refresh(this.cookies.read(request)),
        response,
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) this.cookies.clear(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(
      this.cookies.read(request),
      request.headers.authorization,
    );
    this.cookies.clear(response);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.profiles.get(request.user.id);
  }

  private respond(
    result: Awaited<ReturnType<AuthService['login']>>,
    response: Response,
  ) {
    this.cookies.set(response, result.refreshToken, result.expiresAt);
    return result.body;
  }
}
