import {
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1 } from '../config/api-version.js';
import { parseEntityId } from '../users/user-input.js';
import { pageSchema, parseGroupInput } from '../groups/group-input.js';
import { NotificationsService } from './notifications.service.js';
@Controller({ path: 'notifications', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}
  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.notifications.list(
      request.user.id,
      parseGroupInput(pageSchema, query),
    );
  }
  @Patch(':id/read')
  read(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.notifications.read(request.user.id, parseEntityId(id));
  }
}
