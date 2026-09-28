import { assessmentHref, resolveWorkoutMode } from "./workout-mode.ts";
/** Keep only known local destinations, including the temporary assessment mode. */
export function authDestination(next: string): string {
  if (
    /^\/workouts(?:\/[a-f0-9-]+)?$/.test(next) ||
    /^\/account\/workouts(?:\/history\/\d{4}-\d{2}-\d{2}|\/[a-f0-9-]+\/replay)?$/.test(
      next,
    ) ||
    /^\/measurements(?:\/new|\/[a-f0-9-]+(?:\/edit)?)?$/.test(next) ||
    [
      "/",
      "/account",
      "/account/settings",
      "/account/preferences",
      "/workout",
      "/onboarding",
      "/onboarding/manual",
      "/onboarding/photo",
    ].includes(next)
  )
    return next;
  if (next.startsWith("/onboarding/complete?") && !next.includes("#")) {
    const query = new URLSearchParams(
      next.slice("/onboarding/complete?".length),
    );
    const ids = query.getAll("record");
    if (
      [...query.keys()].every((key) => key === "record") &&
      ids.length === 1 &&
      /^[a-f0-9-]+$/.test(ids[0])
    )
      return `/onboarding/complete?record=${encodeURIComponent(ids[0])}`;
  }
  if (next.startsWith("/workout?") && !next.includes("#")) {
    const query = new URLSearchParams(next.slice("/workout?".length));
    if ([...query.keys()].some((key) => !["mode", "curriculum"].includes(key)))
      return "/";
    const param = (key: string) => {
      const values = query.getAll(key);
      return values.length > 1 ? values : values[0];
    };
    if (resolveWorkoutMode(param("mode"), param("curriculum")) === "assessment")
      return assessmentHref;
  }
  return "/";
}
