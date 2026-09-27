import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1 } from '../config/api-version.js';
import { parseUserPreferences } from './user-preferences-input.js';
import { UserPreferencesService } from './user-preferences.service.js';
import { invalidUserInput } from './user-input.js';

@Controller({ path: 'users/me/preferences', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class UserPreferencesController {
  constructor(
    @Inject(UserPreferencesService)
    private readonly preferences: UserPreferencesService,
  ) {}

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.preferences.get(request.user.id);
  }

  @Patch()
  update(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    // Validate the whole body before any preference write is attempted.
    if (!request.is('application/json'))
      invalidUserInput([
        { field: 'body', message: 'JSON 객체를 전달해 주세요.' },
      ]);
    const input = parseUserPreferences(body);
    return this.preferences.update(request.user.id, input);
  }
}
