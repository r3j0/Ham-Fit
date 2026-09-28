import { FITNESS_FACTORS } from '../../src/recommendations/workout-contracts.js';
import type {
  FactorVector,
  WeightAdjustment,
} from '../../src/recommendations/workout-contracts.js';
import type { RecommendationCatalog } from '../../src/recommendations/catalog.js';
import { catalogHash } from '../../src/recommendations/catalog.js';

// Deliberately synthetic API fixtures. No data-team source or scoring is used.
export const fixtureVector = (): FactorVector =>
  Object.fromEntries(
    FITNESS_FACTORS.map((factor) => [factor, 0]),
  ) as FactorVector;
export const fixtureAdjustment = (): WeightAdjustment =>
  Object.fromEntries(
    FITNESS_FACTORS.map((factor) => [
      factor,
      { previous: 0.111, delta: 0.222, next: 0.333 },
    ]),
  ) as WeightAdjustment;
export const fixtureCatalog = (
  version = 'test-catalog',
): RecommendationCatalog => {
  const videos = ['TEST_A.mp4', 'TEST_B.mp4'].map((videoId) => ({
    videoId,
    title: `[TEST ONLY] ${videoId}`,
    originalUrl: `http://openapi.kspo.or.kr/web/video/${videoId}`,
    ageGroup: '공통',
    equipment: [],
    fitnessWeights: { ...fixtureVector(), strength: 1 },
    durationSeconds: 100,
  }));
  return {
    version,
    sourceCommit: 'test-fixture',
    sourceUrls: ['https://example.test/fixture'],
    checkedOn: '2026-09-27',
    videos,
    contentHash: catalogHash(videos),
  };
};
