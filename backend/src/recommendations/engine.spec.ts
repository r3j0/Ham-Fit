import { describe, expect, it } from 'vitest';
import { selectBestVideo, vector } from './engine.js';
import type { RecommendationVideo } from './engine.js';
import { loadCatalog } from './catalog.js';
import {
  FACTORS,
  calculatePriority,
  calculateRecentExposure,
  calculateVideoScores,
  calculateWeightAdjustment,
  eligibleLogs,
  excludeRecentVideos,
  filterByAge,
  getFitnessNeed,
  kstDate,
  nextDate,
  recommendNextWorkout,
  roundWeightAdjustment,
  validateWeights,
} from './engine.js';
import type { FactorVector } from './engine.js';
const video = (videoId: string): RecommendationVideo => ({
  videoId,
  title: videoId,
  originalUrl: `http://openapi.kspo.or.kr/web/video/${videoId}`,
  ageGroup: '공통',
  equipment: [],
  durationSeconds: 60,
  fitnessWeights: { ...vector(), strength: 1 },
});
describe('mandatory defect regressions', () => {
  it('future A cannot displace never-performed A, while 30-day-old B history is retained', () => {
    const scored = ['A.mp4', 'B.mp4'].map((id) => ({
      video: video(id),
      score: 1,
    }));
    const history = [{ videoId: 'B.mp4', date: '2026-08-28', completed: true }];
    expect(
      selectBestVideo(scored, history, '2026-09-27', () => 0.99).videoId,
    ).toBe('A.mp4');
    expect(
      selectBestVideo(
        scored,
        [...history, { videoId: 'A.mp4', date: '2026-10-07', completed: true }],
        '2026-09-27',
        () => 0.99,
      ).videoId,
    ).toBe('A.mp4');
  });
  it('also excludes a future instant on the same Korean date when the server reference includes time', () => {
    const scored = ['A.mp4', 'B.mp4'].map((id) => ({
      video: video(id),
      score: 1,
    }));
    const history = [
      { videoId: 'B.mp4', date: '2026-08-28T00:00:00Z', completed: true },
      { videoId: 'A.mp4', date: '2026-09-27T09:00:00Z', completed: true },
    ];
    expect(
      selectBestVideo(scored, history, '2026-09-27T08:00:00Z', () => 0.99)
        .videoId,
    ).toBe('A.mp4');
    expect(
      calculateWeightAdjustment(
        scored.map((v) => v.video),
        history,
        '2026-09-27T08:00:00Z',
      ).strength.delta,
    ).toBe(0);
    expect(
      calculateWeightAdjustment(
        scored.map((v) => v.video),
        history,
        '2026-09-27T09:00:00Z',
      ).strength.delta,
    ).toBe(0.3);
  });
});

describe('original baseline semantics and product boundaries', () => {
  const videos = loadCatalog().videos;
  const pure = videos.find((v) => v.fitnessWeights.strength === 1)!;
  const mixed = videos.find(
    (v) => Object.values(v.fitnessWeights).filter((w) => w > 0).length > 1,
  )!;
  const log = (days: number, completed = true, id = mixed.videoId) => ({
    videoId: id,
    date: new Date(Date.parse('2026-09-27T00:00:00Z') - days * 86_400_000)
      .toISOString()
      .slice(0, 10),
    completed,
  });
  it.each([
    [1, 0.25],
    [2, 0.5],
    [3, 1],
    [4, 1],
  ])('grade %s maps to need %s', (grade, need) =>
    expect(getFitnessNeed(grade)).toBe(need),
  );
  it.each([null, true, '2', 0, -1, NaN, Infinity, undefined])(
    'invalid grade %s remains unmeasured',
    (grade) => expect(getFitnessNeed(grade)).toBeNull(),
  );
  it('preserves measured versus missing priority', () => {
    const priority = calculatePriority(
      { strength: { status: 'graded', grade: 2, need: 0.5 } },
      vector(0.4),
    );
    expect(priority.strength).toBeCloseTo(1.1, 12);
    expect(priority.flexibility).toBeCloseTo(0.9, 12);
  });
  it.each([13, 18, 19, 64])(
    'age %s admits only the expected product groups',
    (age) =>
      expect(new Set(filterByAge(videos, age).map((v) => v.ageGroup))).toEqual(
        new Set(age < 19 ? ['공통', '청소년'] : ['공통', '성인']),
      ),
  );
  it.each([12, 65, -1, NaN, Infinity, 13.5])(
    'rejects unsupported product age %s',
    (age) => expect(() => filterByAge(videos, age)).toThrow('unsupported_age'),
  );
  it.each([-1, 0, 1, 7, 14, 15])(
    'exposure daysAgo=%s uses 1–14 only',
    (days) => {
      const exposure = calculateRecentExposure(
        videos,
        [log(days)],
        '2026-09-27',
      );
      for (const f of FACTORS)
        expect(exposure[f]).toBeCloseTo(
          days >= 1 && days <= 14
            ? 0.3 * mixed.fitnessWeights[f] * 0.5 ** (days / 7)
            : 0,
          12,
        );
    },
  );
  it('interrupted exposure is half, missing historical video ignored, empty logs zero', () => {
    const full = calculateRecentExposure(videos, [log(1)], '2026-09-27');
    const half = calculateRecentExposure(videos, [log(1, false)], '2026-09-27');
    for (const f of FACTORS) expect(half[f]).toBe(full[f] / 2);
    expect(
      calculateRecentExposure(
        videos,
        [log(1, true, 'missing.mp4')],
        '2026-09-27',
      ),
    ).toEqual(vector());
    expect(calculateRecentExposure(videos, [], '2026-09-27')).toEqual(vector());
  });
  it('rejects malformed dates/completion, normalizes KST instants and keeps old history', () => {
    expect(() =>
      eligibleLogs([{ ...log(1), date: 'not-a-date' }], '2026-09-27'),
    ).toThrow();
    expect(() =>
      eligibleLogs(
        [{ ...log(1), completed: 'false' as unknown as boolean }],
        '2026-09-27',
      ),
    ).toThrow();
    expect(() => kstDate('2026-02-30')).toThrow();
    expect(() => kstDate('2026-02-30T00:00:00Z')).toThrow();
    expect(kstDate('2026-09-26T15:30:00Z')).toBe('2026-09-27');
    expect(eligibleLogs([log(30), log(-1)], '2026-09-27')).toHaveLength(1);
  });
  it.each([0, 1, 7, 8])('duplicate exclusion daysAgo=%s', (days) =>
    expect(
      excludeRecentVideos(
        videos,
        [log(days, true, pure.videoId)],
        '2026-09-27',
      ).some((v) => v.videoId === pure.videoId),
    ).toBe(!(days >= 1 && days <= 7)),
  );
  it('relaxes only recent restrictions when age candidates exhausted', () => {
    const allowed = filterByAge(videos, 30);
    const result = recommendNextWorkout({
      videos,
      age: 30,
      fitness: {},
      logs: allowed.map((v) => log(1, true, v.videoId)),
      referenceDate: '2026-09-27',
      rng: () => 0,
    });
    expect(result.candidateIds).toEqual(allowed.map((v) => v.videoId));
  });
  it('scores a weighted inner product', () => {
    const priority = Object.fromEntries(
      FACTORS.map((f, i) => [f, i / 4]),
    ) as FactorVector;
    for (const { video: v, score } of calculateVideoScores(
      videos.slice(0, 9),
      priority,
    ))
      expect(score).toBe(
        FACTORS.reduce((sum, f) => sum + v.fitnessWeights[f] * priority[f], 0),
      );
  });
  it('uses oldest latest history then injected RNG and numpy-close scores', () => {
    const scored = ['A.mp4', 'B.mp4'].map((id) => ({
      video: video(id),
      score: 1,
    }));
    expect(
      selectBestVideo(
        scored,
        [
          log(30, true, 'A.mp4'),
          log(20, true, 'B.mp4'),
          log(10, true, 'A.mp4'),
        ],
        '2026-09-27',
        () => 0,
      ).videoId,
    ).toBe('B.mp4');
    expect(selectBestVideo(scored, [], '2026-09-27', () => 0.99).videoId).toBe(
      'B.mp4',
    );
    scored[0].score = 1 - 1e-6;
    expect(selectBestVideo(scored, [], '2026-09-27', () => 0).videoId).toBe(
      'A.mp4',
    );
    expect(() => selectBestVideo(scored, [], '2026-09-27', () => 1)).toThrow(
      'RNG',
    );
  });
  it('today adjustment is immediate but today recommendation excludes today from exposure', () => {
    const history = [log(0, true, pure.videoId)];
    expect(
      calculateRecentExposure(videos, history, '2026-09-27').strength,
    ).toBe(0);
    expect(
      calculateWeightAdjustment(videos, history, '2026-09-27').strength,
    ).toEqual({ previous: 0, delta: 0.3, next: 0.3 });
    expect(
      calculateRecentExposure(videos, history, nextDate('2026-09-27')).strength,
    ).toBeCloseTo(0.3 * 0.5 ** (1 / 7), 12);
    expect(
      calculateWeightAdjustment(
        videos,
        [log(0, false, pure.videoId)],
        '2026-09-27',
      ).strength.delta,
    ).toBe(0.15);
  });
  it('caps exposure, recalculates without drift, retains internal precision', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      log(i, true, pure.videoId),
    );
    const adjustment = calculateWeightAdjustment(videos, history, '2026-09-27');
    const previous =
      0.3 * [1, 2, 3, 4].reduce((sum, i) => sum + 0.5 ** (i / 7), 0);
    expect(adjustment.strength).toEqual({
      previous,
      delta: 1 - previous,
      next: 1,
    });
    expect(calculateWeightAdjustment(videos, history, '2026-09-27')).toEqual(
      adjustment,
    );
    expect(roundWeightAdjustment(adjustment).strength.previous).toBe(
      Number(previous.toFixed(3)),
    );
  });
  it('multiple distinct assignments can contribute on one performed date (late completions)', () =>
    expect(
      calculateWeightAdjustment(
        videos,
        [log(0, true, pure.videoId), log(0, false, pure.videoId)],
        '2026-09-27',
      ).strength.delta,
    ).toBeCloseTo(0.45, 12));
  it.each([NaN, Infinity, -0.1, 1.1])('weight %s cannot activate', (weight) =>
    expect(() =>
      validateWeights({ ...vector(), strength: weight }, 'broken.mp4'),
    ).toThrow('broken.mp4'),
  );
});
