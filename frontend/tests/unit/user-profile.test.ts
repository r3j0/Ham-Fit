import test from "node:test";
import assert from "node:assert/strict";
import { isUserProfile } from "../../lib/user-profile.ts";
const profile = {
  id: "user",
  email: "profile@example.test",
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
  isOnboarded: true,
  currency: { balance: 0 },
  currentCurriculum: null,
};
test("daily workout states preserve onboarding and account profile access", () => {
  assert.equal(isUserProfile(profile), true);
  for (const status of [
    "assigned",
    "in_progress",
    "not_performed",
    "interrupted",
    "completed",
  ]) {
    assert.equal(
      isUserProfile({
        ...profile,
        currentCurriculum: {
          id: "assignment",
          status,
          assignedAt: profile.created_at,
          completedAt: status === "completed" ? profile.created_at : null,
          curriculum: { id: "definition", name: "workout" },
        },
      }),
      true,
      status,
    );
  }
});
test("unknown workout states and incomplete legacy profiles remain rejected", () => {
  assert.equal(
    isUserProfile({
      ...profile,
      currentCurriculum: {
        id: "assignment",
        status: "unknown",
        assignedAt: profile.created_at,
        completedAt: null,
        curriculum: { id: "definition", name: "workout" },
      },
    }),
    false,
  );
  const { isOnboarded, ...legacy } = profile;
  assert.equal(isOnboarded, true);
  assert.equal(isUserProfile(legacy), false);
});
