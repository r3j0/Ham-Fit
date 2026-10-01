import {
  invalid,
  integer,
  object,
  text,
  timestamp,
  uuid,
} from "./api-contract.ts";
import { isWorkoutDate } from "./workout-history.ts";
/** Completion receipt remains gated until its backend contract is available. */
export interface ActivityReward {
  routineId: string;
  koreanDate: string;
  seed: {
    status: "granted" | "already_granted" | "not_eligible";
    amount: number;
    transactionId: string | null;
  };
  waters: { groupId: string; groupName: string; roundId: string; amount: 1 }[];
  personalTicketIds: string[];
}
export function parseActivityReward(value: unknown): ActivityReward {
  const row = object(value),
    seed = object(row.seed);
  if (
    !uuid(row.routineId) ||
    !text(row.koreanDate) ||
    !isWorkoutDate(row.koreanDate) ||
    !["granted", "already_granted", "not_eligible"].includes(
      String(seed.status),
    ) ||
    (seed.status === "granted"
      ? seed.amount !== 1 || !uuid(seed.transactionId)
      : seed.amount !== 0 || seed.transactionId !== null) ||
    !Array.isArray(row.waters) ||
    !Array.isArray(row.personalTicketIds) ||
    !row.personalTicketIds.every(uuid) ||
    new Set(row.personalTicketIds).size !== row.personalTicketIds.length
  )
    invalid();
  const waters = row.waters.map(object);
  if (
    waters.some(
      (w) =>
        !uuid(w.groupId) ||
        !uuid(w.roundId) ||
        !text(w.groupName) ||
        w.amount !== 1,
    ) ||
    new Set(waters.map((w) => w.groupId)).size !== waters.length
  )
    invalid();
  return row as unknown as ActivityReward;
}
export interface PersonalTicket {
  id: string;
  achievementId: string;
  koreanDate: string;
  segmentStartDate: string;
  streakDays: number;
  createdAt: string;
  policyVersion: string;
  status: "available" | "used";
  usable: boolean;
  usedAt: string | null;
}
function validateMilestone(row: Record<string, unknown>) {
  if (
    !text(row.koreanDate) ||
    !isWorkoutDate(row.koreanDate) ||
    !text(row.segmentStartDate) ||
    !isWorkoutDate(row.segmentStartDate) ||
    !integer(row.streakDays, 5) ||
    row.streakDays % 5 !== 0 ||
    (Date.parse(row.koreanDate) - Date.parse(row.segmentStartDate)) / 86400000 +
      1 !==
      row.streakDays
  )
    invalid();
}
export function parsePersonalTicket(value: unknown): PersonalTicket {
  const row = object(value);
  validateMilestone(row);
  if (
    !uuid(row.id) ||
    !uuid(row.achievementId) ||
    !timestamp(row.createdAt) ||
    !text(row.policyVersion) ||
    !["available", "used"].includes(String(row.status)) ||
    typeof row.usable !== "boolean" ||
    row.usable !== (row.status === "available") ||
    !(row.usedAt === null || timestamp(row.usedAt)) ||
    (row.status === "used") !== (row.usedAt !== null)
  )
    invalid();
  return row as unknown as PersonalTicket;
}
export const personalPolicyVersion = "streak-2026-10-01-v1";
// Display only. Source: backend/docs/streak-roulette.md, checked 2026-10-01.
// Future policy versions need their own table; this table never decides a draw.
export const personalPolicy = [
  { label: "해바라기씨 1개", probability: 60 },
  { label: "해바라기씨 3개", probability: 25 },
  { label: "해바라기씨 5개", probability: 10 },
  { label: "해바라기씨 10개", probability: 4.3 },
  { label: "랜덤 의상", probability: 0.6 },
  { label: "랜덤 자세", probability: 0.1 },
] as const;
export interface PersonalDraw {
  id: string;
  ticketId: string;
  drawnAt: string;
  policyVersion: string;
  originalResult:
    "seeds_1" | "seeds_3" | "seeds_5" | "seeds_10" | "clothing" | "pose";
  actualReward: {
    kind: "seeds" | "clothing" | "pose";
    amount: number;
    productId: string | null;
    transactionId: string | null;
  };
  fallback: { applied: boolean; reason: "no_eligible_product" | null };
  achievement: {
    id: string;
    koreanDate: string;
    segmentStartDate: string;
    streakDays: number;
    achievedAt: string;
    sourceKind: "routine" | "daily_assignment";
    sourceId: string;
  };
}
export function parsePersonalDraw(value: unknown): PersonalDraw {
  const row = object(value),
    reward = object(row.actualReward),
    fallback = object(row.fallback),
    achievement = object(row.achievement);
  validateMilestone(achievement);
  if (
    !uuid(row.id) ||
    !uuid(row.ticketId) ||
    !timestamp(row.drawnAt) ||
    !text(row.policyVersion) ||
    !["seeds_1", "seeds_3", "seeds_5", "seeds_10", "clothing", "pose"].includes(
      String(row.originalResult),
    ) ||
    !uuid(achievement.id) ||
    !uuid(achievement.sourceId) ||
    !timestamp(achievement.achievedAt) ||
    !["routine", "daily_assignment"].includes(String(achievement.sourceKind)) ||
    !["seeds", "clothing", "pose"].includes(String(reward.kind)) ||
    !integer(reward.amount, 1) ||
    typeof fallback.applied !== "boolean"
  )
    invalid();
  if (reward.kind === "seeds") {
    if (reward.productId !== null || !uuid(reward.transactionId)) invalid();
    const item =
      row.originalResult === "clothing" || row.originalResult === "pose";
    if (
      fallback.applied !== item ||
      fallback.reason !== (item ? "no_eligible_product" : null)
    )
      invalid();
  } else if (
    reward.amount !== 1 ||
    !text(reward.productId) ||
    reward.transactionId !== null ||
    row.originalResult !== reward.kind ||
    fallback.applied ||
    fallback.reason !== null
  )
    invalid();
  return row as unknown as PersonalDraw;
}
