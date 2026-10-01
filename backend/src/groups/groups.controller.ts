import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js';
import { API_V1 } from '../config/api-version.js';
import { invalidUserInput, parseEntityId } from '../users/user-input.js';
import {
  applicationPageSchema,
  createGroupSchema,
  joinGroupSchema,
  pageSchema,
  parseGroupInput,
  requestKey,
  transferGroupSchema,
  updateGroupSchema,
} from './group-input.js';
import { GroupsService } from './groups.service.js';

@Controller({ path: 'groups', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class GroupsController {
  constructor(
    @Inject(GroupsService) private readonly groups: GroupsService,
    @Inject(AuthRateLimitService) private readonly limits: AuthRateLimitService,
  ) {}
  private json(request: AuthenticatedRequest) {
    if (!request.is('application/json'))
      invalidUserInput([
        { field: 'body', message: 'JSON 형식으로 입력해 주세요.' },
      ]);
  }
  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    this.json(request);
    return this.groups.create(
      request.user.id,
      requestKey(key),
      parseGroupInput(createGroupSchema, body),
    );
  }
  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.groups.list(
      request.user.id,
      parseGroupInput(pageSchema, query),
    );
  }
  @Post('join-requests')
  async apply(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    this.json(request);
    const input = parseGroupInput(joinGroupSchema, body);
    const parsedKey = requestKey(key);
    await this.limits.consume(`group-invite:${request.user.id}`, 10, 60);
    return this.groups.apply(request.user.id, parsedKey, input.inviteCode);
  }
  @Get(':groupId')
  detail(@Req() request: AuthenticatedRequest, @Param('groupId') id: string) {
    return this.groups.detail(request.user.id, parseEntityId(id));
  }
  @Get(':groupId/members/:userId')
  member(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') id: string,
    @Param('userId') userId: string,
  ) {
    return this.groups.detail(
      request.user.id,
      parseEntityId(id),
      parseEntityId(userId),
    );
  }
  @Get(':groupId/invite-code')
  invite(@Req() request: AuthenticatedRequest, @Param('groupId') id: string) {
    return this.groups.inviteCode(request.user.id, parseEntityId(id));
  }
  @Patch(':groupId')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') id: string,
    @Body() body: unknown,
  ) {
    this.json(request);
    return this.groups.update(
      request.user.id,
      parseEntityId(id),
      parseGroupInput(updateGroupSchema, body),
    );
  }
  @Get(':groupId/join-requests')
  applications(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') id: string,
    @Query() query: unknown,
  ) {
    return this.groups.applications(
      request.user.id,
      parseEntityId(id),
      parseGroupInput(applicationPageSchema, query),
    );
  }
  @Post(':groupId/join-requests/:requestId/approve')
  @HttpCode(200)
  approve(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') id: string,
    @Param('requestId') requestId: string,
  ) {
    return this.groups.decide(
      request.user.id,
      parseEntityId(id),
      parseEntityId(requestId),
      'approved',
    );
  }
  @Post(':groupId/join-requests/:requestId/reject')
  @HttpCode(200)
  reject(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') id: string,
    @Param('requestId') requestId: string,
  ) {
    return this.groups.decide(
      request.user.id,
      parseEntityId(id),
      parseEntityId(requestId),
      'rejected',
    );
  }
  @Post(':groupId/leadership')
  @HttpCode(204)
  transfer(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') id: string,
    @Body() body: unknown,
  ) {
    this.json(request);
    return this.groups.transfer(
      request.user.id,
      parseEntityId(id),
      parseGroupInput(transferGroupSchema, body).userId,
    );
  }
  @Delete(':groupId/members/me')
  @HttpCode(204)
  leave(@Req() request: AuthenticatedRequest, @Param('groupId') id: string) {
    return this.groups.leave(request.user.id, parseEntityId(id));
  }
  @Delete(':groupId/members/:userId')
  @HttpCode(204)
  kick(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') id: string,
    @Param('userId') userId: string,
  ) {
    return this.groups.kick(
      request.user.id,
      parseEntityId(id),
      parseEntityId(userId),
    );
  }
  @Delete(':groupId')
  @HttpCode(204)
  delete(@Req() request: AuthenticatedRequest, @Param('groupId') id: string) {
    return this.groups.delete(request.user.id, parseEntityId(id));
  }
}
