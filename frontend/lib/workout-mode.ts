export const assessmentHref = "/workout?mode=assessment";
export type WorkoutMode = "workout" | "assessment" | "unsupported";
/** URL selection is independent of the user's persisted curriculum assignment. */
export function resolveWorkoutMode(
  mode?: string | string[],
  curriculum?: string | string[],
): WorkoutMode {
  if (Array.isArray(mode) || Array.isArray(curriculum)) return "unsupported";
  if (mode !== undefined)
    return mode === "assessment" && curriculum === undefined
      ? "assessment"
      : "unsupported";
  if (curriculum === "adult-self-assessment-v1") return "assessment"; // Existing bookmarks.
  return curriculum === undefined ? "workout" : "unsupported";
}
