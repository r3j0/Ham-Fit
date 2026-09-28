import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { WorkoutCatalogService } from './workout-catalog.service.js';
import {
  DisconnectedWorkoutAlgorithm,
  WorkoutAlgorithm,
} from './workout-algorithm.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    WorkoutCatalogService,
    { provide: WorkoutAlgorithm, useClass: DisconnectedWorkoutAlgorithm },
  ],
  exports: [RecommendationsService, WorkoutCatalogService],
})
export class RecommendationsModule {}
