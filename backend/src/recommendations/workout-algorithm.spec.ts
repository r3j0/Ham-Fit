import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { DisconnectedWorkoutAlgorithm } from './workout-algorithm.js';

describe('disconnected recommendation integration', () => {
  it.each(['recommend', 'weightAdjustment'] as const)(
    '%s fails explicitly without a fallback calculation',
    async (method) => {
      const algorithm = new DisconnectedWorkoutAlgorithm();
      try {
        await algorithm[method]();
        expect.fail('The disconnected algorithm must never generate a result');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(
          (error as ServiceUnavailableException).getResponse(),
        ).toMatchObject({
          statusCode: 503,
          code: 'RECOMMENDATION_NOT_CONNECTED',
        });
      }
    },
  );
});
