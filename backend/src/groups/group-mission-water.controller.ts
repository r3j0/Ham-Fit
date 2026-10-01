import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1 } from '../config/api-version.js';
import { invalidUserInput } from '../users/user-input.js';
import { parseGroupInput, requestKey } from './group-input.js';
import { GroupMissionWaterService } from './group-mission-water.service.js';

const sourceSchema = z.strictObject({
  sourceKind: z.enum(['routine', 'daily_assignment']),
  sourceId: z.uuid().transform((id) => id.toLowerCase()),
});
const selectionSchema = sourceSchema.extend({
  groupId: z.uuid().transform((id) => id.toLowerCase()),
});
@Controller({ path: 'users/me/group-mission-water', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class GroupMissionWaterController {
  constructor(
    @Inject(GroupMissionWaterService)
    private readonly water: GroupMissionWaterService,
  ) {}
  @Get()
  get(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.water.get(
      request.user.id,
      parseGroupInput(sourceSchema, query),
    );
  }
  @Post()
  select(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    if (!request.is('application/json'))
      invalidUserInput([
        { field: 'body', message: 'JSON 형식으로 입력해 주세요.' },
      ]);
    const { groupId, ...source } = parseGroupInput(selectionSchema, body);
    return this.water.select(request.user.id, source, groupId, requestKey(key));
  }
}
