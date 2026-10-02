import type { Page } from "@playwright/test";
import { installCommerce, rewardId as id } from "./avatar-rewards-fixtures";
import { testUser } from "./integration-fixtures";
import { homeGroup } from "./home-groups-fixtures";
import { routineFixture } from "../fixtures/routine";
import { shiftDay } from "../../lib/workout-history";

export async function installStreakCompletion(page: Page) {
  await installCommerce(page);
  await page.clock.setFixedTime(new Date("2026-10-02T03:00:00Z"));
  const today = "2026-10-02";
  function completedRoutine(day: string, index: number) {
    const row = routineFixture();
    row.id = id(100 + index);
    row.koreanDate = day;
    row.referenceDate = shiftDay(day, -1);
    row.serverKoreanDate = today;
    row.serverTime = `${today}T03:00:00.000Z`;
    row.createdAt = `${shiftDay(day, -1)}T03:00:00.000Z`;
    row.recordingExpiresAt = `${day}T15:00:00.000Z`;
    row.recordingAllowed = day === today;
    row.status = "completed";
    row.progress.completedItems = row.routine.length;
    row.routine.forEach((item) => {
      item.status = item.resultStatus = "completed";
      item.completedAt = item.performedAt = `${day}T03:00:00.000Z`;
      item.progress.watchedSeconds = 60;
      item.progress.intervals = [{ start: 0, end: 60 }];
    });
    return row;
  }
  const routine = completedRoutine(today, 0);
  const previous = [4, 3, 2, 1].map((n) =>
    completedRoutine(shiftDay(today, -n), n),
  );
  const group = homeGroup(1, 2);
  group.name = "매일 함께 운동";
  group.members[1].nickname = "운동친구";
  const state = {
    completed: true,
    streak: 5,
    tickets: 1,
    granted: true,
    groups: true,
    mission: "contributed" as "contributed" | "none" | "pending",
    rewardError: false,
    waterError: false,
    ticketError: false,
  };
  await page.route("**/api/v2/workout-routines/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/history"))
      return route.fulfill({
        json: {
          items: state.completed ? [...previous, routine] : previous,
          nextCursor: null,
          serverKoreanDate: today,
        },
      });
    if (path.endsWith("/current") && !state.completed)
      return route.fulfill({ json: null });
    return route.fulfill({ json: routine });
  });
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/v1/workouts/current", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/api/v1/users/me/profile/activity", (route) =>
    route.fulfill({
      json: {
        userId: testUser.id,
        nickname: "햄스터",
        profileCharacter: null,
        streak: state.completed ? state.streak : 4,
      },
    }),
  );
  await page.route("**/api/v1/users/me/activity-rewards?*", (route) =>
    state.rewardError
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: {
            routineId: routine.id,
            koreanDate: today,
            seed: { status: "granted", amount: 1, transactionId: id(200) },
            waters: [],
            personalTicketIds: state.granted ? [id(201)] : [],
          },
        }),
  );
  await page.route("**/api/v1/users/me/streak-roulette/tickets?*", (route) =>
    state.ticketError
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: { items: [], availableCount: state.tickets, nextCursor: null },
        }),
  );
  await page.route("**/api/v1/groups/overview", (route) =>
    route.fulfill({
      json: {
        items: state.groups ? [{ ...group, role: "leader" }] : [],
      },
    }),
  );
  await page.route("**/api/v1/groups?*", (route) =>
    route.fulfill({
      json: {
        items: state.groups ? [{ ...group, role: "leader" }] : [],
        nextCursor: null,
      },
    }),
  );
  await page.route("**/api/v1/users/me/group-mission-water**", (route) => {
    if (state.waterError) return route.fulfill({ status: 503, json: {} });
    const available = state.groups && state.mission !== "none";
    return route.fulfill({
      json: {
        sourceKind: "routine",
        sourceId: routine.id,
        koreanDate: today,
        status: !available ? "unavailable" : state.mission,
        reason: available ? null : "no_eligible_missions",
        options:
          state.mission === "pending" && available
            ? [
                {
                  groupId: group.id,
                  groupName: group.name,
                  roundId: id(210),
                  waterCount: 3,
                  totalTarget: 28,
                  stage: "sprout",
                },
              ]
            : [],
        contribution:
          available && state.mission === "contributed"
            ? {
                groupId: group.id,
                groupName: group.name,
                roundId: id(210),
                amount: 1,
              }
            : null,
      },
    });
  });
  return { state, routine, base: `/workout-routines/${routine.id}/complete` };
}
