import { expect, test } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";

test("기본 출시 설정은 미구현 지급 API를 호출하거나 보상 획득을 주장하지 않는다", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_PROPOSED_REWARDS === "true",
    "기본 false 출시 설정의 서버에서 실행",
  );
  await installApi(page, testRecord());
  const routine = routineFixture();
  routine.status = "completed";
  routine.progress.completedItems = 3;
  for (const i of routine.routine) {
    i.status = "completed";
    i.resultStatus = "completed";
    i.completedAt = routine.serverTime;
    i.performedAt = routine.serverTime;
    i.progress.watchedSeconds = 48;
    i.progress.intervals = [{ start: 0, end: 48 }];
  }
  await page.route("**/api/v2/workout-routines/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/history")
        ? { items: [routine], nextCursor: null }
        : routine,
    }),
  );
  const proposed: string[] = [];
  page.on("request", (req) => {
    if (
      /\/users\/me\/(activity-rewards|roulette|streak-roulette)/.test(req.url())
    )
      proposed.push(req.url());
  });
  if (process.env.E2E_PERSONAL_ROULETTE !== "true") {
    await page.goto("/roulette/personal");
    await expect(
      page.getByRole("heading", { name: "개인 룰렛을 준비하고 있어요" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "룰렛 돌리기" })).toHaveCount(
      0,
    );
  }
  await page.goto(`/workout-routines/${routine.id}/complete/streak`);
  await expect(
    page.getByRole("link", { name: "메인으로", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/해바라기씨 1개를 받았어요|해바라기에 물을 줬어요/),
  ).toHaveCount(0);
  expect(proposed).toEqual([]);
});
