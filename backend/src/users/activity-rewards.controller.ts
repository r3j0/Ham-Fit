import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1 } from '../config/api-version.js';
import { parseGroupInput } from '../groups/group-input.js';
import { ActivityRewardsService } from './activity-rewards.service.js';

const receiptQuery = z.strictObject({
  routineId: z.uuid().transform((value) => value.toLowerCase()),
});

@Controller({ path: 'users/me/activity-rewards', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class ActivityRewardsController {
  constructor(
    @Inject(ActivityRewardsService)
    private readonly rewards: ActivityRewardsService,
  ) {}
  @Get()
  get(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const input = parseGroupInput(receiptQuery, query);
    return this.rewards.receipt(request.user.id, input.routineId);
  }
}
