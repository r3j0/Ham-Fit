import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [GroupsController, NotificationsController],
  providers: [GroupsService, NotificationsService],
  exports: [GroupsService],
})
export class GroupsModule {}
