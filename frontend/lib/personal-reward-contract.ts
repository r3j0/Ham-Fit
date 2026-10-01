import {
  invalid,
  integer,
  number,
  object,
  text,
  timestamp,
  uuid,
} from "./api-contract.ts";
import { parseInventory, type Inventory } from "./shop-contract.ts";
import { isWorkoutDate } from "./workout-history.ts";
/** Proposed API: enable only after BE accepts frontend/BACKEND-REQUESTS.md. */
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
  earnedAt: string;
  koreanDate: string;
  streak: number;
  policyVersion: string;
  status: "available" | "used" | "invalidated";
  usable: boolean;
  usedAt: string | null;
}
export function parsePersonalTicket(value: unknown): PersonalTicket {
  const row = object(value);
  if (
    !uuid(row.id) ||
    !timestamp(row.earnedAt) ||
    !text(row.koreanDate) ||
    !isWorkoutDate(row.koreanDate) ||
    !integer(row.streak, 5) ||
    row.streak % 5 !== 0 ||
    !text(row.policyVersion) ||
    !["available", "used", "invalidated"].includes(String(row.status)) ||
    typeof row.usable !== "boolean" ||
    !(row.usedAt === null || timestamp(row.usedAt)) ||
    (row.status === "used") !== (row.usedAt !== null) ||
    (row.usable && row.status !== "available")
  )
    invalid();
  return row as unknown as PersonalTicket;
}
export interface PersonalPolicy {
  version: string;
  rewards: {
    id: string;
    kind: "currency" | "clothing" | "pose";
    amount: number | null;
    probability: number;
  }[];
}
export function parsePersonalPolicy(value: unknown): PersonalPolicy {
  const row = object(value);
  if (!text(row.version) || !Array.isArray(row.rewards) || !row.rewards.length)
    invalid();
  let total = 0;
  const ids = new Set();
  for (const r of row.rewards.map(object)) {
    if (
      !text(r.id) ||
      ids.has(r.id) ||
      !["currency", "clothing", "pose"].includes(String(r.kind)) ||
      !number(r.probability) ||
      r.probability > 100 ||
      (r.kind === "currency" ? !integer(r.amount, 1) : r.amount !== null)
    )
      invalid();
    ids.add(r.id);
    total += r.probability;
  }
  if (Math.abs(total - 100) > 0.00001) invalid();
  return row as unknown as PersonalPolicy;
}
export interface PersonalDraw extends Inventory {
  id: string;
  ticketId: string;
  drawnAt: string;
  policyVersion: string;
  result:
    | { kind: "currency"; amount: number; productId: null }
    | { kind: "clothing" | "pose"; amount: null; productId: string };
}
export function parsePersonalDraw(value: unknown): PersonalDraw {
  const row = object(value),
    result = object(row.result),
    inventory = parseInventory(row);
  if (
    !uuid(row.id) ||
    !uuid(row.ticketId) ||
    !timestamp(row.drawnAt) ||
    !text(row.policyVersion) ||
    !["currency", "clothing", "pose"].includes(String(result.kind)) ||
    (result.kind === "currency"
      ? !integer(result.amount, 1) || result.productId !== null
      : result.amount !== null ||
        !text(result.productId) ||
        !inventory.inventory.some((i) => i.productId === result.productId))
  )
    invalid();
  return row as unknown as PersonalDraw;
}
