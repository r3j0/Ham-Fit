import { ActivityRewardsController } from './activity-rewards.controller.js';
import { ActivityRewardsService } from './activity-rewards.service.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersController } from './users.controller.js';
import { UserPreferencesController } from './user-preferences.controller.js';
import { UserPreferencesService } from './user-preferences.service.js';
import { UserProfileController } from './user-profile.controller.js';
import { UserProfileModule } from './user-profile.module.js';

@Module({
  imports: [AuthModule, DatabaseModule, UserProfileModule],
  controllers: [
    UsersController,
    ActivityRewardsController,
    UserPreferencesController,
    UserProfileController,
  ],
  providers: [UserPreferencesService, ActivityRewardsService],
})
export class UsersModule {}
