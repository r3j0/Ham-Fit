import { DatabaseModule } from '../database/database.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvatarController, ShopController } from './avatar.controller.js';
import {
  AvatarManagerController,
  AvatarManagerV2Controller,
  AvatarAssetsController,
} from './assets.controller.js';
import { AvatarManagerGuard } from './assets.guard.js';
import { AvatarAssetsService } from './assets.service.js';
import { AvatarService } from './avatar.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    AvatarController,
    ShopController,
    AvatarManagerController,
    AvatarManagerV2Controller,
    AvatarAssetsController,
  ],
  providers: [AvatarService, AvatarManagerGuard, AvatarAssetsService],
  exports: [AvatarService],
})
export class AvatarModule {}
