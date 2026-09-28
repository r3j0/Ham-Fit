import {
  fitnessDate,
  fitnessRecordId,
  invalidFitness,
  parsePolygonAxes,
  polygonForDisplay,
} from "./fitness-contract.ts";
import type { FitnessAxis } from "./fitness-evaluation.ts";
export const latestFitnessPath = "/measurements/latest-polygon";
export interface LatestFitnessProfile {
  measurement: { id: string; revision: number; measuredOn: string };
  axes: FitnessAxis[];
}
/** A latest polygon is one server-selected record, including six unmeasured axes when empty. */
export function parseLatestFitness(
  value: unknown,
): LatestFitnessProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidFitness();
  const v = value as Record<string, unknown>;
  if (
    v.measurementId === null &&
    v.measuredOn === null &&
    v.revision === null
  ) {
    parsePolygonAxes(v.axes, null);
    return null;
  }
  if (
    !fitnessRecordId(v.measurementId) ||
    !fitnessDate(v.measuredOn) ||
    typeof v.revision !== "number" ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1
  )
    return invalidFitness();
  return {
    measurement: {
      id: v.measurementId,
      measuredOn: v.measuredOn,
      revision: v.revision,
    },
    axes: polygonForDisplay(parsePolygonAxes(v.axes, v.revision)),
  };
}
