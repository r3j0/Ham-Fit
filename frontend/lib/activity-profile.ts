import { api, getSession } from "./session";
import { invalid } from "./api-contract";
import { parseActivity } from "./groups";
export const getActivityProfile = (signal?: AbortSignal) =>
  api<unknown>("/users/me/profile/activity", { signal }).then(({ data }) => {
    const row = parseActivity(data);
    if (row.userId !== getSession().user?.id) invalid();
    return row;
  });
