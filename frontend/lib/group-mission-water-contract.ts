import { invalid, integer, object, text, uuid } from "./api-contract.ts";
import { isWorkoutDate } from "./workout-history.ts";
import { missionStages, type MissionStage } from "./group-mission-contract.ts";

export interface WaterOption {
  groupId: string;
  groupName: string;
  roundId: string;
  waterCount: number;
  totalTarget: number;
  stage: MissionStage;
}
export interface WaterContribution {
  groupId: string;
  groupName: string;
  roundId: string;
  amount: 1;
}
type WaterBase = {
  sourceId: string;
  sourceKind: "routine" | "daily_assignment";
  koreanDate: string;
};
export type MissionWater = WaterBase &
  (
    | {
        status: "pending";
        reason: null;
        options: WaterOption[];
        contribution: null;
      }
    | {
        status: "contributed";
        reason: null;
        options: [];
        contribution: WaterContribution;
      }
    | {
        status: "unavailable";
        reason:
          | "no_eligible_missions"
          | "not_first_completion"
          | "expired"
          | "missions_ended";
        options: [];
        contribution: null;
      }
  );
export function parseMissionWater(value: unknown): MissionWater {
  const row = object(value);
  if (
    !uuid(row.sourceId) ||
    !["routine", "daily_assignment"].includes(String(row.sourceKind)) ||
    !text(row.koreanDate) ||
    !isWorkoutDate(row.koreanDate) ||
    !Array.isArray(row.options)
  )
    invalid();
  if (row.status === "pending") {
    if (row.reason !== null || row.contribution !== null || !row.options.length)
      invalid();
    const options = row.options.map(object);
    for (const o of options) {
      if (
        !uuid(o.groupId) ||
        !uuid(o.roundId) ||
        !text(o.groupName) ||
        !integer(o.waterCount) ||
        !integer(o.totalTarget, 28) ||
        o.totalTarget % 14 !== 0 ||
        o.waterCount >= o.totalTarget ||
        !missionStages.includes(o.stage as MissionStage)
      )
        invalid();
      const n = o.totalTarget / 14;
      const thresholds = [0, n, 3 * n, 7 * n, 14 * n];
      if (
        missionStages[
          thresholds.filter((t) => (o.waterCount as number) >= t).length - 1
        ] !== o.stage
      )
        invalid();
    }
    if (new Set(options.map((o) => o.groupId)).size !== options.length)
      invalid();
  } else if (row.status === "contributed") {
    const c = object(row.contribution);
    if (
      row.reason !== null ||
      row.options.length ||
      !uuid(c.groupId) ||
      !uuid(c.roundId) ||
      !text(c.groupName) ||
      c.amount !== 1
    )
      invalid();
  } else if (row.status === "unavailable") {
    if (
      row.options.length ||
      row.contribution !== null ||
      ![
        "no_eligible_missions",
        "not_first_completion",
        "expired",
        "missions_ended",
      ].includes(String(row.reason))
    )
      invalid();
  } else invalid();
  return row as unknown as MissionWater;
}
