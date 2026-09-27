import { describe, expect, it } from 'vitest';
import { evaluateMeasurement } from '../measurements/evaluation/measurement-evaluator.js';
import type { EvaluationInput } from '../measurements/evaluation/evaluation-types.js';
import { adaptMeasurement, latestMeasurement } from './measurement-adapter.js';
import { calculatePriority, vector } from './engine.js';
import type { RecommendationMeasurement } from './measurement-adapter.js';
const base: EvaluationInput = {
  id: 'measurement-a',
  revision: 3,
  measuredOn: '2026-09-26',
  ageAtMeasurement: 25,
  sexAtMeasurement: 'male',
  entryMethod: 'self_assessment',
  catalogVersion: 'nfa100-2026-09-24-grip-v1',
  items: [
    { measurementCode: 'ymca_recovery_heart_rate', value: '90', unit: 'bpm' },
    { measurementCode: 'height', value: '170', unit: 'cm' },
    { measurementCode: 'weight', value: '65', unit: 'kg' },
  ],
};
function record(
  overrides: Partial<EvaluationInput> = {},
): RecommendationMeasurement {
  const input = { ...base, ...overrides };
  const result = evaluateMeasurement(input, new Date('2026-09-26T00:00:00Z'));
  return {
    ...input,
    createdAt: new Date('2026-09-26T00:00:00Z'),
    items: input.items.map((item) => ({
      ...item,
      reportedGrade: null,
      evaluation: result.items.find(
        (i) => i.measurementCode === item.measurementCode,
      )!.evaluation,
    })),
    axes: result.axes,
  };
}
describe('stored-measurement recommendation adapter', () => {
  it('preserves YMCA reference classification, raw measurement, conversion and criterion provenance', () => {
    const measurement = record();
    const before = structuredClone(measurement);
    const { fitness, snapshot } = adaptMeasurement(measurement);
    expect(fitness.cardiovascularEndurance).toEqual({
      status: 'graded',
      grade: 1,
      need: 0.25,
    });
    expect(snapshot).toMatchObject({
      measurementId: 'measurement-a',
      measurementRevision: 3,
      measurementCatalogVersion: base.catalogVersion,
    });
    const factor = snapshot.factors.find(
      (f) => f.factor === 'cardiovascularEndurance',
    )!;
    expect(factor.originalItem).toMatchObject({
      measurementCode: 'ymca_recovery_heart_rate',
      value: '90',
      unit: 'bpm',
      evaluation: {
        conversion: {
          assessmentKind: 'reference',
          formulaVersion: 'nfa100-adult-step-vo2max-v1',
          inputs: base.items,
        },
        criterion: { measurementCode: 'step_test_vo2max' },
      },
    });
    expect(factor.originalItem!.evaluation.criterion!.source.url).toBeTruthy();
    expect(
      factor.originalItem!.evaluation.criterion!.internalVersion,
    ).toBeTruthy();
    expect(measurement).toEqual(before);
  });
  it('uses need 1 for below standard without changing stored null grade', () => {
    const measurement = record({
      entryMethod: 'manual',
      items: [
        { measurementCode: 'relative_grip_strength', value: '0', unit: '%' },
      ],
    });
    const result = adaptMeasurement(measurement);
    expect(result.fitness.strength).toEqual({
      status: 'below_standard',
      grade: null,
      need: 1,
    });
    expect(
      result.snapshot.factors.find((f) => f.factor === 'strength')!
        .originalItem!.evaluation.grade,
    ).toBeNull();
    expect(calculatePriority(result.fitness, vector()).strength).toBe(2);
  });
  it('keeps unmeasured and unevaluable distinct, with identical missing-priority rule', () => {
    const result = adaptMeasurement(record({ items: [base.items[0]] }));
    expect(result.fitness.cardiovascularEndurance).toEqual({
      status: 'unevaluable',
      grade: null,
      need: null,
    });
    expect(result.fitness.muscularEndurance).toEqual({
      status: 'not_measured',
      grade: null,
      need: null,
    });
    expect(
      result.snapshot.factors.find(
        (f) => f.factor === 'cardiovascularEndurance',
      )!.originalItem!.evaluation.reasonCode,
    ).toBe('height_at_measurement_missing');
    const priority = calculatePriority(result.fitness, vector(0.2));
    expect(priority.cardiovascularEndurance).toBeCloseTo(1.2, 12);
    expect(priority.muscularEndurance).toBeCloseTo(1.2, 12);
  });
  it('selects one latest record with measuredOn desc, createdAt desc, id asc and never backfills', () => {
    const old = record();
    const latest = record({
      id: 'latest',
      measuredOn: '2026-09-27',
      items: [{ measurementCode: 'sit_and_reach', value: '25', unit: 'cm' }],
    });
    expect(latestMeasurement([old, latest])).toBe(latest);
    expect(
      adaptMeasurement(latestMeasurement([old, latest])!).fitness
        .cardiovascularEndurance!.status,
    ).toBe('not_measured');
    const newerCreated = {
      ...latest,
      id: 'z',
      createdAt: new Date('2026-09-26T00:01:00Z'),
    };
    expect(latestMeasurement([latest, newerCreated])).toBe(newerCreated);
    const sameTime = { ...newerCreated, id: 'a' };
    expect(latestMeasurement([newerCreated, sameTime])).toBe(sameTime);
    expect(latestMeasurement([])).toBeNull();
  });
  it('does not re-evaluate past stored assessments when current age changes', () => {
    const measurement = record();
    const converted = measurement.items[0].evaluation;
    adaptMeasurement(measurement);
    expect(measurement.items[0].evaluation).toBe(converted);
    expect(converted.ageAtMeasurement).toBe(25);
  });
});
