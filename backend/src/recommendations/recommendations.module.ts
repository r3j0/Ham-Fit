import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { WorkoutCatalogService } from './workout-catalog.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, WorkoutCatalogService],
  exports: [RecommendationsService, WorkoutCatalogService],
})
export class RecommendationsModule {}
