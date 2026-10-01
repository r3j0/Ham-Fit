import { AvatarModule } from '../avatar/avatar.module.js';
import { GroupMissionsController } from './group-missions.controller.js';
import { GroupMissionsService } from './group-missions.service.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
@Module({
  imports: [AuthModule, DatabaseModule, AvatarModule],
  controllers: [
    GroupsController,
    GroupMissionsController,
    NotificationsController,
  ],
  providers: [GroupsService, GroupMissionsService, NotificationsService],
  exports: [GroupsService, GroupMissionsService],
})
export class GroupsModule {}
