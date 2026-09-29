import { GroupsModule } from './groups/groups.module.js';
import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module.js';
import { CurriculaModule } from './curricula/curricula.module.js';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MeasurementsModule } from './measurements/measurements.module.js';
import { RecommendationsModule } from './recommendations/recommendations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    MeasurementsModule,
    UsersModule,
    CurriculaModule,
    RecommendationsModule,
    GroupsModule,
  ],
})
export class AppModule {}
