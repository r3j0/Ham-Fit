import { DatabaseModule } from '../database/database.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvatarController, ShopController } from './avatar.controller.js';
import { AvatarService } from './avatar.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AvatarController, ShopController],
  providers: [AvatarService],
  exports: [AvatarService],
})
export class AvatarModule {}
