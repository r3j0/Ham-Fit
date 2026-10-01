import {
  invalid,
  integer,
  object,
  text,
  timestamp,
  uuid,
} from "./api-contract.ts";
export const missionStages = [
  "seed",
  "sprout",
  "stem",
  "bud",
  "sunflower",
] as const;
export type MissionStage = (typeof missionStages)[number];
export interface ActiveMission {
  id: string;
  groupId: string;
  status: "in_progress" | "completed";
  startedAt: string;
  completedAt: string | null;
  memberCount: number;
  waterCount: number;
  totalTarget: number;
  stage: MissionStage;
  stageTargets: Record<MissionStage, number>;
  policyVersion: string;
  me: {
    eligible: boolean;
    reason: "eligible" | "not_in_snapshot" | "membership_ended";
    waterCount: number;
  };
}
export type Mission = { id: null; status: "not_started" } | ActiveMission;
export interface RouletteTicket {
  id: string;
  roundId: string;
  createdAt: string;
  policyVersion: string;
  status: "available" | "used" | "invalidated";
  usable: boolean;
  usedAt: string | null;
  invalidatedAt: string | null;
}
export const groupResults = [
  "self_1",
  "self_3",
  "self_5",
  "self_7",
  "contributors_3",
  "contributors_7",
] as const;
export type GroupResult = (typeof groupResults)[number];
export interface GroupDraw {
  id: string;
  ticketId: string;
  roundId: string;
  drawnAt: string;
  policyVersion: string;
  result: GroupResult;
  amountPerRecipient: number;
  recipients: { userId: string | null; amount: number }[];
  myReward: { amount: number; transactionId: string | null }[];
}
export function parseMission(value: unknown): Mission {
  const row = object(value);
  if (row.status === "not_started" && row.id === null)
    return { status: "not_started", id: null };
  const me = object(row.me),
    targets = object(row.stageTargets);
  if (
    !uuid(row.id) ||
    !uuid(row.groupId) ||
    !["in_progress", "completed"].includes(String(row.status)) ||
    !timestamp(row.startedAt) ||
    !(row.completedAt === null || timestamp(row.completedAt)) ||
    !integer(row.memberCount, 2) ||
    !integer(row.waterCount) ||
    !integer(row.totalTarget, 1) ||
    row.waterCount > row.totalTarget ||
    !missionStages.includes(row.stage as MissionStage) ||
    !text(row.policyVersion) ||
    !missionStages.every((s) => integer(targets[s])) ||
    typeof me.eligible !== "boolean" ||
    !["eligible", "not_in_snapshot", "membership_ended"].includes(
      String(me.reason),
    ) ||
    me.eligible !== (me.reason === "eligible") ||
    !integer(me.waterCount) ||
    me.waterCount > row.waterCount ||
    (row.status === "completed") !== (row.completedAt !== null)
  )
    invalid();
  const thresholds = missionStages.map((s) => targets[s] as number);
  if (
    thresholds[0] !== 0 ||
    thresholds[4] !== row.totalTarget ||
    thresholds.some((n, i) => i > 0 && n <= thresholds[i - 1]) ||
    missionStages[
      thresholds.filter((t) => (row.waterCount as number) >= t).length - 1
    ] !== row.stage ||
    (row.status === "completed") !== (row.waterCount === row.totalTarget)
  )
    invalid();
  return row as unknown as ActiveMission;
}
export function parseTicket(value: unknown): RouletteTicket {
  const row = object(value);
  if (
    !uuid(row.id) ||
    !uuid(row.roundId) ||
    !timestamp(row.createdAt) ||
    !text(row.policyVersion) ||
    !["available", "used", "invalidated"].includes(String(row.status)) ||
    typeof row.usable !== "boolean" ||
    !(row.usedAt === null || timestamp(row.usedAt)) ||
    !(row.invalidatedAt === null || timestamp(row.invalidatedAt)) ||
    (row.status === "used") !== (row.usedAt !== null) ||
    (row.usable && (row.status !== "available" || row.invalidatedAt !== null))
  )
    invalid();
  return row as unknown as RouletteTicket;
}
export function parseGroupDraw(value: unknown): GroupDraw {
  const row = object(value);
  if (
    ![row.id, row.ticketId, row.roundId].every(uuid) ||
    !timestamp(row.drawnAt) ||
    !text(row.policyVersion) ||
    !groupResults.includes(row.result as GroupResult) ||
    !integer(row.amountPerRecipient, 1) ||
    !Array.isArray(row.recipients) ||
    !row.recipients.length ||
    !Array.isArray(row.myReward)
  )
    invalid();
  const expected = Number(String(row.result).split("_").at(-1));
  if (row.amountPerRecipient !== expected) invalid();
  for (const r of row.recipients.map(object))
    if (!(r.userId === null || uuid(r.userId)) || r.amount !== expected)
      invalid();
  for (const r of row.myReward.map(object))
    if (
      r.amount !== expected ||
      !(r.transactionId === null || uuid(r.transactionId))
    )
      invalid();
  if (row.myReward.length > 1) invalid();
  return row as unknown as GroupDraw;
}
