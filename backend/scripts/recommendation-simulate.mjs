// npm run build && node scripts/recommendation-simulate.mjs
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { loadCatalog } from '../dist/src/recommendations/catalog.js';
import {
  ALGORITHM_VERSION,
  FACTORS,
  calculateWeightAdjustment,
  nextDate,
  recommendNextWorkout,
} from '../dist/src/recommendations/engine.js';
const catalog = loadCatalog();
const simulations = [];
for (const age of [13, 18, 19, 30, 64]) {
  let seed = 927 + age;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const logs = [];
  const days = [];
  let referenceDate = '2026-09-27';
  for (let day = 0; day < 21; day++) {
    const recommendation = recommendNextWorkout({
      videos: catalog.videos,
      age,
      fitness: {
        strength: { status: 'graded', grade: 3, need: 1 },
        flexibility: { status: 'graded', grade: 1, need: 0.25 },
      },
      logs,
      referenceDate,
      rng,
    });
    assert(recommendation.tiedCandidateIds.includes(recommendation.videoId));
    const video = catalog.videos.find(
      (v) => v.videoId === recommendation.videoId,
    );
    assert(
      (age < 19 ? ['공통', '청소년'] : ['공통', '성인']).includes(
        video.ageGroup,
      ),
    );
    assert(!logs.slice(-7).some((log) => log.videoId === video.videoId));
    const completed = day % 3 !== 0;
    logs.push({ videoId: video.videoId, date: referenceDate, completed });
    const adjustment = calculateWeightAdjustment(
      catalog.videos,
      logs,
      referenceDate,
    );
    for (const factor of FACTORS)
      assert(
        adjustment[factor].previous >= 0 &&
          adjustment[factor].next <= 1 &&
          adjustment[factor].delta >= 0,
      );
    days.push({
      date: referenceDate,
      videoId: video.videoId,
      completed,
      candidateCount: recommendation.candidateIds.length,
      tiedCandidateCount: recommendation.tiedCandidateIds.length,
      exposure: recommendation.exposure,
      priority: recommendation.priority,
      adjustment,
    });
    referenceDate = nextDate(referenceDate);
  }
  simulations.push({
    age,
    days,
    distinctVideos: new Set(logs.map((log) => log.videoId)).size,
  });
}
const report = {
  algorithmVersion: ALGORITHM_VERSION,
  catalogVersion: catalog.version,
  catalogHash: catalog.contentHash,
  status: 'passed',
  totalDays: simulations.length * 21,
  simulations,
};
await writeFile(
  'data/recommendation/validation/typescript-simulations.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    status: report.status,
    simulations: simulations.length,
    totalDays: report.totalDays,
  }),
);
