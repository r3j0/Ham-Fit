import { test, expect } from "@playwright/test";
import { installApi, testRecord, testWorkout } from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";
import { prepareAssessment } from "./workout-helpers";
import type { Workout } from "../../lib/workout-types";

test("메인과 운동 탭은 오늘의 여러 배정을 모두 보여주고 시작·이어하기만 진행 화면으로 연결한다", async ({
  page,
}) => {
  const api = await installApi(page, testRecord());
  const resumed: Workout = {
    ...testWorkout,
    id: "second",
    status: "interrupted",
    video: { ...testWorkout.video, title: "두 번째 운동" },
  };
  const done: Workout = {
    ...testWorkout,
    id: "third",
    status: "completed",
    video: { ...testWorkout.video, title: "완료한 세 번째 운동" },
  };
  const previous = {
    ...testWorkout,
    id: "previous",
    koreanDate: "2026-09-26",
    video: { ...testWorkout.video, title: "어제 운동" },
  };
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has("cursor")
        ? { items: [done, previous], nextCursor: null }
        : { items: [testWorkout, resumed], nextCursor: "next-page" },
    }),
  );
  await page.goto("/");
  for (const path of ["/", "/workout"]) {
    if (path === "/workout")
      await page
        .getByRole("navigation")
        .getByRole("link", { name: "운동", exact: true })
        .click();
    const today = page.getByRole("region", {
      name: "오늘의 운동",
      exact: true,
    });
    const list = today.getByRole("list", { name: "오늘 배정된 운동" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(
      today.getByRole("link", { name: "운동 시작하기", exact: true }),
    ).toHaveAttribute("href", `/workouts/${testWorkout.id}`);
    await expect(
      today.getByRole("link", { name: "운동 이어하기", exact: true }),
    ).toHaveAttribute("href", "/workouts/second");
    await expect(list.getByText("완료", { exact: true })).toHaveCount(1);
    await expect(today.getByRole("link")).toHaveCount(2);
    await expect(
      today.getByText(
        /내 운동 이력|운동 상태 새로고침|내 측정 기록과 운동 이력|배정 ·|저장된 시청량|어제 운동/,
      ),
    ).toHaveCount(0);
    await expect(today.locator("video")).toHaveCount(0);
    await expect(page.getByRole("timer")).toHaveCount(0);
  }
  await page.getByRole("link", { name: "운동 시작하기", exact: true }).click();
  await expect(page).toHaveURL(`/workouts/${testWorkout.id}`);
  await expect(
    page.getByRole("heading", { name: "운동 중", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("현재 이 영상을 재생할 수 없어요.", { exact: false }),
  ).toBeVisible();
  expect(api.mutations).toEqual([]);
});

test("오늘 배정이 없으면 이전 운동을 오늘로 표시하지 않고 오늘 루틴을 명시적으로 준비한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  const previous = { ...testWorkout, koreanDate: "2026-09-26" };
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: [previous], nextCursor: null } }),
  );
  let requests = 0;
  let generated: ReturnType<typeof routineFixture> | null = null;
  await page.route("**/api/v2/workout-routines/current", (route) =>
    route.fulfill({ json: generated }),
  );
  await page.route("**/api/v2/workout-routines/today", (route) => {
    requests++;
    generated = routineFixture();
    return route.fulfill({
      status: 201,
      json: generated,
    });
  });
  await page.goto("/workout");
  await expect(
    page.getByText("아직 오늘 배정된 운동이 없어요.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }),
  ).toHaveCount(0);
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(page.locator("video")).toHaveCount(0);
  expect(requests).toBe(1);
});

test("공용 타이머 변경 후에도 간이측정의 고정 시간·중단 재시작 정책을 유지한다", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/workout?mode=assessment");
  await prepareAssessment(page);
  await page.clock.install();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.clock.fastForward(23000);
  await page.getByRole("button", { name: "측정 중단", exact: true }).click();
  await page.getByRole("button", { name: "이 항목 다시 시작" }).click();
  await page.clock.fastForward(3050);
  await expect(page.getByRole("timer", { name: "남은 시간" })).toContainText(
    "1:00",
  );
  await page.clock.fastForward(60000);
  await expect(page.getByLabel("성공한 횟수 (회)")).toBeVisible();
  await page.getByLabel("성공한 횟수 (회)").fill("0");
  await page.getByRole("button", { name: "입력하고 다음으로" }).click();
  await page.getByRole("button", { name: "측정 시작", exact: true }).click();
  await page.clock.fastForward(253000);
  await expect(page.getByLabel("10초 동안 센 맥박 (회)")).toBeVisible();
});

test("다른 기기에서 완료한 운동은 화면 복귀 시 완료로 바뀌며 별도 새로고침 버튼은 없다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  let current = testWorkout;
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: [current], nextCursor: null } }),
  );
  await page.goto("/workout");
  const list = page.getByRole("list", { name: "오늘 배정된 운동" });
  await expect(list.getByRole("link", { name: "운동 시작하기" })).toBeVisible();
  current = {
    ...testWorkout,
    revision: testWorkout.revision + 1,
    status: "completed",
    completedAt: "2026-09-27T03:00:00.000Z",
  };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(list.getByText("완료", { exact: true })).toBeVisible();
  await expect(list.getByRole("link")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "운동 상태 새로고침" }),
  ).toHaveCount(0);
});
