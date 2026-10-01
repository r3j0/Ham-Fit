import { Module } from '@nestjs/common';
import { AvatarModule } from '../avatar/avatar.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { StreakRouletteController } from './streak-roulette.controller.js';
import { StreakRouletteService } from './streak-roulette.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, AvatarModule],
  controllers: [StreakRouletteController],
  providers: [StreakRouletteService],
})
export class StreakRouletteModule {}
