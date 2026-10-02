import { api, invalidateUserProfile } from "./session";
import { invalid, object, integer, pageOf } from "./api-contract";
import { readPages } from "./groups";
import {
  parseActivityReward,
  parsePersonalDraw,
  parsePersonalTicket,
} from "./personal-reward-contract";
export const dailyRewardsEnabled =
  process.env.NEXT_PUBLIC_DAILY_REWARDS_ENABLED === "true";
export const personalRouletteEnabled =
  process.env.NEXT_PUBLIC_PERSONAL_ROULETTE_ENABLED === "true";
export async function getActivityReward(
  routineId: string,
  signal?: AbortSignal,
) {
  if (!dailyRewardsEnabled && !personalRouletteEnabled) return null;
  const { data } = await api<unknown>(
    `/users/me/activity-rewards?routineId=${encodeURIComponent(routineId)}`,
    { signal },
  );
  const row = parseActivityReward(data);
  if (row.routineId !== routineId) invalid();
  return row;
}
export const getPersonalTickets = (signal?: AbortSignal) =>
  readPages("/users/me/streak-roulette/tickets", parsePersonalTicket, signal);
export async function getPersonalTicketCount(signal?: AbortSignal) {
  const { data } = await api<unknown>(
    "/users/me/streak-roulette/tickets?limit=1",
    { signal },
  );
  const row = object(data);
  pageOf(row, parsePersonalTicket);
  if (!integer(row.availableCount)) invalid();
  return row.availableCount;
}
export async function spinPersonal(body: string, key: string) {
  const { data } = await api<unknown>("/users/me/streak-roulette/spins", {
    method: "POST",
    body,
    headers: { "X-CSRF-Protection": "1", "Idempotency-Key": key },
  });
  const row = object(data),
    draw = parsePersonalDraw(row.draw);
  if (
    typeof row.replayed !== "boolean" ||
    draw.ticketId !== JSON.parse(body).ticketId
  )
    invalid();
  invalidateUserProfile();
  return draw;
}
