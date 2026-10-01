import { api, invalidateUserProfile } from "./session";
import { invalid, object } from "./api-contract";
import { ApiError } from "./http";
import { parseMissionWater } from "./group-mission-water-contract";

export async function getMissionWater(
  id: string,
  signal?: AbortSignal,
  sourceKind: "routine" | "daily_assignment" = "routine",
) {
  const { data } = await api<unknown>(
    `/users/me/group-mission-water?sourceKind=${sourceKind}&sourceId=${encodeURIComponent(id)}`,
    { signal },
  );
  const water = parseMissionWater(data);
  if (water.sourceId !== id || water.sourceKind !== sourceKind) invalid();
  return water;
}
export async function selectMissionWater(body: string, key: string) {
  try {
    const { data } = await api<unknown>("/users/me/group-mission-water", {
      method: "POST",
      body,
      headers: { "X-CSRF-Protection": "1", "Idempotency-Key": key },
    });
    const row = object(data),
      water = parseMissionWater(row.water),
      input = JSON.parse(body);
    if (
      typeof row.replayed !== "boolean" ||
      water.sourceId !== input.sourceId ||
      water.sourceKind !== input.sourceKind ||
      water.status !== "contributed" ||
      water.contribution.groupId !== input.groupId
    )
      invalid();
    invalidateUserProfile();
    return water;
  } catch (error) {
    if (error instanceof ApiError && error.code) {
      const messages: Record<string, string> = {
        WATER_ALREADY_CONTRIBUTED:
          "오늘의 물은 이미 다른 그룹에 반영됐어요. 저장된 결과를 확인해 주세요.",
        WATER_OPTION_UNAVAILABLE:
          "선택한 미션에 물을 줄 수 없어요. 다른 그룹을 선택해 주세요.",
        WATER_EXPIRED: "물 주기는 운동을 완료한 날에만 할 수 있어요.",
      };
      if (messages[error.code])
        throw new ApiError(
          error.status,
          messages[error.code],
          {},
          undefined,
          error.code,
        );
    }
    throw error;
  }
}
