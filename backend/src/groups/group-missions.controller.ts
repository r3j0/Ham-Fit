import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1 } from '../config/api-version.js';
import { invalidUserInput, parseEntityId } from '../users/user-input.js';
import { pageSchema, parseGroupInput, requestKey } from './group-input.js';
import { GroupMissionsService } from './group-missions.service.js';

const emptySchema = z.strictObject({});
const spinSchema = z.strictObject({
  ticketId: z.uuid().transform((id) => id.toLowerCase()),
});
@Controller({ path: 'groups/:groupId', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class GroupMissionsController {
  constructor(
    @Inject(GroupMissionsService)
    private readonly missions: GroupMissionsService,
  ) {}
  private json(request: AuthenticatedRequest) {
    if (!request.is('application/json'))
      invalidUserInput([
        { field: 'body', message: 'JSON 형식으로 입력해 주세요.' },
      ]);
  }
  @Post('missions/start')
  start(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    this.json(request);
    parseGroupInput(emptySchema, body);
    return this.missions.start(
      request.user.id,
      parseEntityId(groupId),
      requestKey(key),
    );
  }
  @Get('missions/current')
  current(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
  ) {
    return this.missions.current(request.user.id, parseEntityId(groupId));
  }
  @Get('missions')
  history(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Query() query: unknown,
  ) {
    return this.missions.history(
      request.user.id,
      parseEntityId(groupId),
      parseGroupInput(pageSchema, query),
    );
  }
  @Get('roulette/tickets')
  tickets(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Query() query: unknown,
  ) {
    return this.missions.tickets(
      request.user.id,
      parseEntityId(groupId),
      parseGroupInput(pageSchema, query),
    );
  }
  @Post('roulette/spins')
  spin(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    this.json(request);
    const input = parseGroupInput(spinSchema, body);
    return this.missions.spin(
      request.user.id,
      parseEntityId(groupId),
      input.ticketId,
      requestKey(key),
    );
  }
  @Get('roulette/draws')
  draws(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Query() query: unknown,
  ) {
    return this.missions.draws(
      request.user.id,
      parseEntityId(groupId),
      parseGroupInput(pageSchema, query),
    );
  }
}
