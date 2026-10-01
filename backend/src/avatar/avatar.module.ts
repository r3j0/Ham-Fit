import { DatabaseModule } from '../database/database.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvatarController, ShopController } from './avatar.controller.js';
import {
  AvatarManagerController,
  AvatarAssetsController,
} from './assets.controller.js';
import { AvatarManagerGuard } from './assets.guard.js';
import { AvatarAssetFiles } from './assets-files.js';
import { AvatarAssetStorage } from './assets-storage.js';
import { AvatarAssetsService } from './assets.service.js';
import { AvatarService } from './avatar.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    AvatarController,
    ShopController,
    AvatarManagerController,
    AvatarAssetsController,
  ],
  providers: [
    AvatarService,
    AvatarManagerGuard,
    AvatarAssetFiles,
    AvatarAssetStorage,
    AvatarAssetsService,
  ],
  exports: [AvatarService],
})
export class AvatarModule {}
