import type {
  ItemEvaluation,
  AxisEvaluation,
} from '../measurements/evaluation/evaluation-types.js';
import { FACTORS, getFitnessNeed } from './engine.js';
import type { Factor, FitnessInput } from './engine.js';

type MeasurementItem = {
  measurementCode: string;
  value: string;
  unit: string;
  reportedGrade: string | null;
  evaluation: ItemEvaluation;
};
export type RecommendationMeasurement = {
  id: string;
  revision: number;
  measuredOn: string;
  createdAt: Date;
  catalogVersion: string;
  items: MeasurementItem[];
  axes: AxisEvaluation[];
};
const AXIS_FACTOR: Record<AxisEvaluation['axis'], Factor> = {
  strength: 'strength',
  muscular_endurance: 'muscularEndurance',
  cardiorespiratory_endurance: 'cardiovascularEndurance',
  flexibility: 'flexibility',
  agility: 'agility',
  power: 'power',
};
/** Matches the representative polygon. Never fill a missing axis from another record. */
export function latestMeasurement(
  records: readonly RecommendationMeasurement[],
): RecommendationMeasurement | null {
  return (
    [...records].sort(
      (a, b) =>
        b.measuredOn.localeCompare(a.measuredOn) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0] ?? null
  );
}
export function adaptMeasurement(record: RecommendationMeasurement) {
  const fitness: FitnessInput = {};
  const factors = FACTORS.map((factor) => {
    const axis = record.axes.find((a) => AXIS_FACTOR[a.axis] === factor);
    const status = axis?.status ?? 'not_measured';
    const grade = axis?.grade ?? null;
    const need =
      status === 'below_standard'
        ? 1
        : status === 'graded'
          ? getFitnessNeed(grade)
          : null;
    fitness[factor] = { status, grade, need };
    const item =
      record.items.find(
        (i) => i.measurementCode === axis?.representativeMeasurementCode,
      ) ?? null;
    // Preserve complete stored evaluation, criterion version/source and conversion evidence.
    // Reference assessmentKind remains reference; no synthetic official certification.
    return {
      factor,
      status,
      grade,
      need,
      reasonCode: axis?.reasonCode ?? 'no_measurements',
      representativeMeasurementCode:
        axis?.representativeMeasurementCode ?? null,
      originalItem: item,
    };
  });
  return {
    fitness,
    snapshot: {
      measurementId: record.id,
      measurementRevision: record.revision,
      measuredOn: record.measuredOn,
      measurementCatalogVersion: record.catalogVersion,
      factors,
    },
  };
}
