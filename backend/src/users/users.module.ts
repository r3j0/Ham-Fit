import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersController } from './users.controller.js';
import { UserPreferencesController } from './user-preferences.controller.js';
import { UserPreferencesService } from './user-preferences.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [UsersController, UserPreferencesController],
  providers: [UserPreferencesService],
})
export class UsersModule {}
