import { test, expect } from "@playwright/test";
import { installApi, testRecord, testWorkout } from "./integration-fixtures";
import { prepareAssessment } from "./workout-helpers";

test("운동 탭은 현재 배정만 표시하고 체험 세트와 타이머를 제거한다", async ({
  page,
}) => {
  const api = await installApi(page, testRecord());
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "운동", exact: true })
    .click();
  await expect(page).toHaveURL("/workout");
  await expect(
    page.getByRole("heading", { name: "내 기존 운동", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("현재 이 영상을 재생할 수 없어요.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
  await expect(page.getByText("체험 운동", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "세트 완료" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "오늘 운동 추천받기" }),
  ).toHaveCount(0);
  expect(api.mutations).toEqual([]);
});

test("미배정 사용자는 명시적으로 추천을 받은 뒤 같은 화면에서 배정 영상을 확인한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  let assigned = false;
  let requests = 0;
  await page.route("**/api/v1/workouts/current", (route) =>
    route.fulfill({ json: assigned ? testWorkout : null }),
  );
  await page.route("**/api/v1/workouts/today", (route) => {
    requests++;
    assigned = true;
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    return route.fulfill({ status: 201, json: testWorkout });
  });
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "오늘의 운동을 받아 보세요" }),
  ).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "오늘 운동 추천받기" }).click();
  await expect(
    page.getByRole("heading", { name: "내 기존 운동", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/workout");
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

test("배정 상태를 새로고침하면 다른 기기에서 완료한 상태를 플레이어에도 반영한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  let current = testWorkout;
  await page.route("**/api/v1/workouts/current", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route(`**/api/v1/workouts/${testWorkout.id}`, (route) =>
    route.fulfill({ json: current }),
  );
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "내 기존 운동", exact: true }),
  ).toBeVisible();
  current = {
    ...testWorkout,
    revision: testWorkout.revision + 1,
    status: "completed",
    completedAt: "2026-09-27T03:00:00.000Z",
  };
  await page.getByRole("button", { name: "운동 상태 새로고침" }).click();
  await expect(
    page.getByText("영상을 다시 볼 수 있고", { exact: false }),
  ).toBeVisible();
});
