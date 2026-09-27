import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersController } from './users.controller.js';
import { UserPreferencesController } from './user-preferences.controller.js';
import { UserPreferencesService } from './user-preferences.service.js';
import { BirthProfileController } from './birth-profile.controller.js';
import { UserProfileModule } from './user-profile.module.js';

@Module({
  imports: [AuthModule, DatabaseModule, UserProfileModule],
  controllers: [
    UsersController,
    UserPreferencesController,
    BirthProfileController,
  ],
  providers: [UserPreferencesService],
})
export class UsersModule {}
