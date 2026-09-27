import { isStoredNickname } from "./nickname.ts";
import type { UserProfile } from "./types.ts";
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
/** An older API response must not turn missing onboarding/currency into invented defaults. */
export function isUserProfile(value: unknown): value is UserProfile {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    typeof value.email !== "string" ||
    !isStoredNickname(value.nickname) ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.updated_at !== "string" ||
    typeof value.isOnboarded !== "boolean" ||
    !object(value.currency) ||
    !Number.isSafeInteger(value.currency.balance) ||
    (value.currency.balance as number) < 0
  )
    return false;
  const current = value.currentCurriculum;
  return (
    current === null ||
    (object(current) &&
      typeof current.id === "string" &&
      [
        "assigned",
        "in_progress",
        "not_performed",
        "interrupted",
        "completed",
      ].includes(current.status as string) &&
      typeof current.assignedAt === "string" &&
      (current.completedAt === null ||
        typeof current.completedAt === "string") &&
      object(current.curriculum) &&
      typeof current.curriculum.id === "string" &&
      typeof current.curriculum.name === "string")
  );
}

/** Elapsed calendar days in Korea; joining today is day 0, even across UTC midnight. */
export function daysSinceJoined(createdAt: string, now = new Date()): number {
  const koreaOffset = 9 * 60 * 60 * 1000;
  const dayMilliseconds = 24 * 60 * 60 * 1000;
  const joinedDay = Math.floor(
    (Date.parse(createdAt) + koreaOffset) / dayMilliseconds,
  );
  const today = Math.floor((now.getTime() + koreaOffset) / dayMilliseconds);
  return Math.max(0, today - joinedDay);
}
