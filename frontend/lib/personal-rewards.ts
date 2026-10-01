import { api, invalidateUserProfile } from "./session";
import { invalid, object } from "./api-contract";
import { readPages } from "./groups";
import {
  parseActivityReward,
  parsePersonalDraw,
  parsePersonalPolicy,
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
  if (!dailyRewardsEnabled) return null;
  const { data } = await api<unknown>(
    `/users/me/activity-rewards?routineId=${encodeURIComponent(routineId)}`,
    { signal },
  );
  const row = parseActivityReward(data);
  if (row.routineId !== routineId) invalid();
  return row;
}
export const getPersonalTickets = (signal?: AbortSignal) =>
  readPages("/users/me/roulette/tickets", parsePersonalTicket, signal);
export const getPersonalPolicy = (version: string, signal?: AbortSignal) =>
  api<unknown>(
    `/users/me/roulette/policy?version=${encodeURIComponent(version)}`,
    { signal },
  ).then(({ data }) => {
    const policy = parsePersonalPolicy(data);
    if (policy.version !== version) invalid();
    return policy;
  });
export async function spinPersonal(body: string, key: string) {
  const { data } = await api<unknown>("/users/me/roulette/spins", {
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
