import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { serializeRecord } from '../measurements/measurements.service.js';
import type {
  RecommendationVideo,
  WeightAdjustment,
  WorkoutLog,
} from './workout-contracts.js';

export type RecommendationRequest = {
  age: number;
  measurement: ReturnType<typeof serializeRecord>;
  videos: readonly RecommendationVideo[];
  logs: readonly WorkoutLog[];
  referenceInstant: string;
};
export type RecommendationDecision = {
  videoId: string;
  algorithmVersion: string;
  snapshot: Prisma.InputJsonObject;
};
export type AdjustmentRequest = {
  videos: readonly RecommendationVideo[];
  logs: readonly WorkoutLog[];
  referenceInstant: string;
};

/** Integration seam only; reconnect after the data team's code reaches main. */
export abstract class WorkoutAlgorithm {
  abstract recommend(
    input: RecommendationRequest,
  ): Promise<RecommendationDecision>;
  abstract weightAdjustment(
    input: AdjustmentRequest,
  ): Promise<WeightAdjustment>;
}

@Injectable()
export class DisconnectedWorkoutAlgorithm extends WorkoutAlgorithm {
  private unavailable(): never {
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: 'RECOMMENDATION_NOT_CONNECTED',
      message: '추천 알고리즘이 아직 연결되지 않았습니다.',
    });
  }

  recommend(): Promise<RecommendationDecision> {
    return this.unavailable();
  }

  weightAdjustment(): Promise<WeightAdjustment> {
    return this.unavailable();
  }
}
