"use client";

import { usePathname } from "next/navigation";

/** Preserve existing detail bookmarks; the workout calendar owns the overview. */
export function useWorkoutHistoryLinks() {
  const inProfile = usePathname().startsWith("/account/");
  return {
    basePath: inProfile ? "/account/workouts" : "/workouts",
    overviewHref: "/workout",
  };
}
