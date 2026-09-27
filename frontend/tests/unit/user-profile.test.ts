import test from "node:test";
import assert from "node:assert/strict";
import { daysSinceJoined, isUserProfile } from "../../lib/user-profile.ts";
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

test("joined days follow Korea's calendar instead of elapsed 24-hour periods", () => {
  assert.equal(
    daysSinceJoined("2026-09-26T15:00:00Z", new Date("2026-09-27T14:59:59Z")),
    0,
  );
  assert.equal(
    daysSinceJoined("2026-09-26T14:59:59Z", new Date("2026-09-26T15:00:00Z")),
    1,
  );
  assert.equal(
    daysSinceJoined("2026-09-01T00:00:00Z", new Date("2026-09-27T00:00:00Z")),
    26,
  );
});
test("joined days handle year boundaries, leap days, and a clock behind the server", () => {
  assert.equal(
    daysSinceJoined("2025-12-31T14:59:59Z", new Date("2025-12-31T15:00:00Z")),
    1,
  );
  assert.equal(
    daysSinceJoined("2024-02-28T15:00:00Z", new Date("2024-03-01T15:00:00Z")),
    2,
  );
  assert.equal(
    daysSinceJoined("2026-09-28T00:00:00Z", new Date("2026-09-27T00:00:00Z")),
    0,
  );
});
