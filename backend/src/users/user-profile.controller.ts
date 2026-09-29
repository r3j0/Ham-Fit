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
import { UserProfileService } from './user-profile.service.js';
import { invalidUserInput } from './user-input.js';

@Controller({ path: 'users/me/profile', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class UserProfileController {
  constructor(
    @Inject(UserProfileService) private readonly profiles: UserProfileService,
  ) {}
  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.profiles.profile(request.user.id);
  }
  @Get('activity')
  activity(@Req() request: AuthenticatedRequest) {
    return this.profiles.activity(request.user.id);
  }
  @Patch()
  update(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    if (!request.is('application/json'))
      invalidUserInput([
        {
          field: 'body',
          message: '프로필을 JSON 형식으로 입력해 주세요.',
        },
      ]);
    return this.profiles.updateProfile(request.user.id, body);
  }
}
