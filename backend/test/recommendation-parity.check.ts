import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadCatalog } from '../src/recommendations/catalog.js';
import {
  FACTORS,
  calculateVideoScores,
  calculateWeightAdjustment,
  filterByAge,
  getFitnessNeed,
  recommendNextWorkout,
  roundWeightAdjustment,
} from '../src/recommendations/engine.js';
import type {
  FactorVector,
  FitnessInput,
  WorkoutLog,
  WeightAdjustment,
} from '../src/recommendations/engine.js';
const referencePath = process.env.RECOMMENDATION_REFERENCE_PATH;
if (!referencePath)
  throw new Error(
    'Run npm run test:recommendation-parity to generate the Python reference first.',
  );
type ParityCase = {
  name: string;
  age: number;
  fitness: Record<string, number>;
  logs: WorkoutLog[];
  referenceDate: string;
  exposure: FactorVector;
  priority: FactorVector;
  ageCandidateIds: string[];
  candidateIds: string[];
  scores: Record<string, number>;
  tiedCandidateIds: string[];
  pythonSelected: string;
  weightAdjustment: WeightAdjustment;
};
describe('Python/TypeScript real-catalog parity', () => {
  const reference = JSON.parse(readFileSync(referencePath, 'utf8')) as {
    cases: ParityCase[];
  };
  const videos = loadCatalog().videos;
  it.each(reference.cases)(
    '$name compares calculations, full candidates, valid random ties and adjustment',
    (fixture) => {
      const fitness = Object.fromEntries(
        Object.entries(fixture.fitness).map(([factor, grade]) => [
          factor,
          { status: 'graded', grade, need: getFitnessNeed(grade) },
        ]),
      ) as FitnessInput;
      const result = recommendNextWorkout({
        videos,
        age: fixture.age,
        fitness,
        logs: fixture.logs,
        referenceDate: fixture.referenceDate,
        rng: () => 0.37,
      });
      for (const factor of FACTORS) {
        expect(result.exposure[factor]).toBeCloseTo(
          fixture.exposure[factor],
          12,
        );
        expect(result.priority[factor]).toBeCloseTo(
          fixture.priority[factor],
          12,
        );
      }
      expect(filterByAge(videos, fixture.age).map((v) => v.videoId)).toEqual(
        fixture.ageCandidateIds,
      );
      expect(result.candidateIds).toEqual(fixture.candidateIds);
      expect(result.tiedCandidateIds).toEqual(fixture.tiedCandidateIds);
      expect(fixture.tiedCandidateIds).toContain(result.videoId);
      expect(result.tiedCandidateIds).toContain(fixture.pythonSelected);
      for (const { video: v, score } of calculateVideoScores(
        videos.filter((v) => result.candidateIds.includes(v.videoId)),
        result.priority,
      ))
        expect(score).toBeCloseTo(fixture.scores[v.videoId], 12);
      expect(
        roundWeightAdjustment(
          calculateWeightAdjustment(
            videos,
            fixture.logs,
            fixture.referenceDate,
          ),
        ),
      ).toEqual(fixture.weightAdjustment);
    },
  );
});
