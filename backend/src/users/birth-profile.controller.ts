import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1 } from '../config/api-version.js';
import { UserProfileService } from './user-profile.service.js';
import { invalidUserInput } from './user-input.js';

@Controller({ path: 'users/me/profile', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class BirthProfileController {
  constructor(
    @Inject(UserProfileService) private readonly profiles: UserProfileService,
  ) {}
  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.profiles.birth(request.user.id);
  }
  @Patch()
  update(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = z.strictObject({ dateOfBirth: z.string() }).safeParse(body);
    if (!request.is('application/json') || !parsed.success)
      invalidUserInput([
        {
          field: 'dateOfBirth',
          message: '생년월일을 YYYY-MM-DD 형식으로 입력해 주세요.',
        },
      ]);
    return this.profiles.updateBirth(request.user.id, parsed.data.dateOfBirth);
  }
}
