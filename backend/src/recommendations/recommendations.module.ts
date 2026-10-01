import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { WorkoutCatalogService } from './workout-catalog.service.js';
import { RoutineAlgorithm } from './routine-algorithm.js';
import { WorkoutRoutinesService } from './workout-routines.service.js';
import { WorkoutRoutinesController } from './workout-routines.controller.js';
import {
  DisconnectedWorkoutAlgorithm,
  WorkoutAlgorithm,
} from './workout-algorithm.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RecommendationsController, WorkoutRoutinesController],
  providers: [
    RecommendationsService,
    WorkoutCatalogService,
    RoutineAlgorithm,
    WorkoutRoutinesService,
    { provide: WorkoutAlgorithm, useClass: DisconnectedWorkoutAlgorithm },
  ],
  exports: [RecommendationsService, WorkoutCatalogService],
})
export class RecommendationsModule {}
