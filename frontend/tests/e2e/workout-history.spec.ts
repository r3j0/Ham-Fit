import { test, expect, type Page } from "@playwright/test";
import { installApi, testRecord, testWorkout } from "./integration-fixtures";
import type { Workout } from "../../lib/workout-types";

// The calendar must remain Korean even when the viewer's local date is the previous day.
test.use({ timezoneId: "America/Los_Angeles" });
const fixedDate = new Date("2026-09-27T12:00:00+09:00");
function completed(id: string, day: string): Workout {
  return {
    ...testWorkout,
    id,
    status: "completed",
    completedAt: `${day}T16:00:00+09:00`,
    koreanDate: "2026-08-01",
  };
}
async function setup(page: Page) {
  const api = await installApi(page, testRecord());
  await page.clock.setFixedTime(fixedDate);
  const rows = [
    completed("today", "2026-09-27"),
    completed("today-again", "2026-09-27"),
    completed("yesterday", "2026-09-26"),
    completed("older", "2026-09-25"),
    testWorkout,
  ];
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: rows, nextCursor: null } }),
  );
  return { ...api, rows };
}

test("서버 완료일만 달력과 스트릭에 표시하고 같은 날 중복 완료는 하루로 집계한다", async ({
  page,
}) => {
  const api = await setup(page);
  await page.goto("/");
  const streak = page.getByRole("region", { name: "운동 스트릭" });
  await expect(streak).toContainText("3일 연속 운동 중");
  await expect(streak).toContainText("오늘의 운동을 완료했어요!");
  await expect(streak.getByRole("listitem")).toHaveCount(7);
  await streak.getByRole("link", { name: "운동 기록 보기" }).click();
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await expect(calendar.getByText("3일 운동했어요")).toBeVisible();
  await expect(
    calendar.getByRole("button", {
      name: "9월 27일 오늘, 운동함",
      exact: true,
    }),
  ).toHaveAttribute("data-completed", "true");
  await expect(
    calendar.getByRole("link", { name: /완료 기록 보기/ }),
  ).toHaveCount(2);
  await expect(
    calendar.getByRole("link", { name: /완료 기록 보기/ }).first(),
  ).toHaveAttribute("href", "/workouts/today");
  await expect(
    calendar.getByRole("button", { name: /운동함으로 체크|체크 해제/ }),
  ).toHaveCount(0);
  await expect(page.getByText("예시 기록", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(calendar.getByText("3일 운동했어요")).toBeVisible();
  expect(api.mutations).toEqual([]);
});

test("달력은 이전 달과 빈 달을 키보드로 탐색하며 배정일을 완료일로 표시하지 않는다", async ({
  page,
}) => {
  const api = await setup(page);
  await page.goto("/workout");
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await expect(
    calendar.getByRole("button", { name: "다음 달" }),
  ).toBeDisabled();
  await expect(
    calendar.getByRole("button", { name: "9월 28일, 아직 오지 않은 날" }),
  ).toBeDisabled();
  await calendar.getByRole("button", { name: "이전 달" }).click();
  await expect(
    calendar.getByRole("heading", { name: "2026년 8월" }),
  ).toBeVisible();
  await expect(calendar.locator("tbody tr")).toHaveCount(6);
  await expect(calendar.getByText("0일 운동했어요")).toBeVisible();
  const date = calendar.getByRole("button", {
    name: "8월 1일, 완료 기록 없음",
    exact: true,
  });
  await date.focus();
  await page.keyboard.press("Enter");
  await expect(date).toHaveAttribute("aria-pressed", "true");
  await expect(calendar.getByText("완료한 운동 기록이 없어요")).toBeVisible();
  await calendar.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(
    calendar.getByRole("button", {
      name: "9월 27일 오늘, 운동함",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(api.mutations).toEqual([]);
});

test("이력의 모든 페이지를 읽고 실패 시 0일로 오인시키지 않으며 재시도로 복구한다", async ({
  page,
}) => {
  await setup(page);
  let fail = true;
  const cursors: (string | null)[] = [];
  await page.route("**/api/v1/workouts/history?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if (cursor && fail)
      return route.fulfill({ status: 503, json: { message: "Unavailable" } });
    return route.fulfill({
      json: cursor
        ? { items: [completed("yesterday", "2026-09-26")], nextCursor: null }
        : { items: [completed("today", "2026-09-27")], nextCursor: "next" },
    });
  });
  await page.goto("/");
  const streak = page.getByRole("region", { name: "운동 스트릭" });
  await expect(streak.getByRole("alert")).toBeVisible();
  await expect(streak).not.toContainText("연속 운동 중");
  expect(cursors).toContain("next");
  fail = false;
  await streak.getByRole("button", { name: "운동 기록 다시 불러오기" }).click();
  await expect(streak).toContainText("2일 연속 운동 중");
  await streak.getByRole("link", { name: "운동 기록 보기" }).click();
  await expect(
    page.getByRole("region", { name: "운동 기록", exact: true }),
  ).toContainText("2일 운동했어요");
});

for (const width of [320, 390, 430, 1280]) {
  test(`${width}px 스트릭과 달력은 화면을 넘치지 않고 모든 날짜를 표시한다`, async ({
    page,
  }, info) => {
    await setup(page);
    await page.clock.setFixedTime(fixedDate);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    await page.goto("/");
    const streak = page.getByRole("region", { name: "운동 스트릭" });
    await expect(streak).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`streak-${width}.png`),
      fullPage: true,
    });
    await streak.getByRole("link", { name: "운동 기록 보기" }).click();
    const calendar = page.getByRole("region", {
      name: "운동 기록",
      exact: true,
    });
    await expect(calendar.getByRole("table")).toBeVisible();
    await expect(calendar.locator("tbody button")).toHaveCount(30);
    for (const button of await calendar.getByRole("button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`calendar-${width}.png`),
      fullPage: true,
    });
  });
}
