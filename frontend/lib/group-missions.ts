import { api, invalidateUserProfile } from "./session";
import { invalid, object } from "./api-contract";
import { readPages } from "./groups";
import {
  parseMission,
  parseTicket,
  parseGroupDraw,
} from "./group-mission-contract";
export const getMission = (id: string, signal?: AbortSignal) =>
  api<unknown>(`/groups/${id}/missions/current`, { signal }).then(
    ({ data }) => {
      const mission = parseMission(data);
      if (mission.id !== null && mission.groupId !== id) invalid();
      return mission;
    },
  );
export const getGroupTickets = (id: string, signal?: AbortSignal) =>
  readPages(`/groups/${id}/roulette/tickets`, parseTicket, signal);
export const getGroupDraws = (id: string, signal?: AbortSignal) =>
  readPages(`/groups/${id}/roulette/draws`, parseGroupDraw, signal);
async function write(path: string, body: string, key: string) {
  return object(
    (
      await api<unknown>(path, {
        method: "POST",
        body,
        headers: { "X-CSRF-Protection": "1", "Idempotency-Key": key },
      })
    ).data,
  );
}
export async function startMission(id: string, body: string, key: string) {
  const data = await write(`/groups/${id}/missions/start`, body, key),
    mission = parseMission(data.mission);
  if (
    typeof data.replayed !== "boolean" ||
    mission.id === null ||
    mission.groupId !== id
  )
    invalid();
  return mission;
}
export async function spinGroup(id: string, body: string, key: string) {
  const data = await write(`/groups/${id}/roulette/spins`, body, key),
    draw = parseGroupDraw(data.draw);
  if (
    typeof data.replayed !== "boolean" ||
    draw.ticketId !== JSON.parse(body).ticketId
  )
    invalid();
  if (draw.myReward.length !== 1) invalid();
  invalidateUserProfile();
  return draw;
}
