"use client";

import { usePathname } from "next/navigation";

/** Keep history browsing in the section that owns the current route. */
export function useWorkoutHistoryLinks() {
  const inProfile = usePathname().startsWith("/account/");
  return {
    basePath: inProfile ? "/account/workouts" : "/workouts",
    overviewHref: inProfile ? "/account/workouts" : "/workout",
  };
}
