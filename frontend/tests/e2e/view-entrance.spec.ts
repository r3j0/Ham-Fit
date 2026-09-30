import { expect, test } from "@playwright/test";
import { installApi, testRecord, testWorkout } from "./integration-fixtures";

type EntranceCall = {
  id: string | undefined;
};

declare global {
  interface Window {
    entranceCalls: EntranceCall[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.entranceCalls = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const id = typeof options === "object" ? options.id : undefined;
      if (id === "view-entrance") {
        window.entranceCalls.push({ id });
      }
      return animate.call(this, keyframes, options);
    };
  });
});

test("페이지 진입은 최초 페인트의 CSS 페이드로 처리하고 이후 갱신에서 재시작하지 않는다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "운동", exact: true }),
  ).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toHaveCSS("animation-name", "view-entrance");
  expect(await page.evaluate(() => window.entranceCalls)).toEqual([]);
  const initialStart = await main.evaluate((element) => {
    const animation = element.getAnimations()[0];
    return animation?.startTime;
  });
  expect(initialStart).not.toBeNull();

  await page.getByRole("button", { name: "이전 달", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2026년 8월" })).toBeVisible();
  expect(
    await main.evaluate((element) => element.getAnimations()[0]?.startTime),
  ).toBe(initialStart);
});

test("메인 전환은 준비된 이력으로 운동을 즉시 표시하고 현재 운동 재조회로 흔들리지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApi(page, testRecord());
  let releaseCurrent!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  await page.route("**/api/v2/workout-routines/current", async (route) => {
    await currentGate;
    await route.fulfill({ json: null });
  });

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "내 프로필" })).toBeVisible();
  await page.getByRole("link", { name: "메인", exact: true }).click();
  await expect(page).toHaveURL("/");
  const today = page.getByRole("region", {
    name: "오늘의 운동",
    exact: true,
  });
  await expect(
    today.getByRole("heading", { name: "내 기존 운동" }),
  ).toBeVisible();
  await expect(today.locator(".loading")).toHaveCount(0);
  const before = (await today.boundingBox())!;

  const currentResponse = page.waitForResponse((response) =>
    response.url().endsWith("/workout-routines/current"),
  );
  releaseCurrent();
  await currentResponse;
  await expect(today.locator(".loading")).toHaveCount(0);
  const after = (await today.boundingBox())!;
  expect(after.height).toBeCloseTo(before.height, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
});

test("메인의 초기 로딩 슬롯은 실제 운동 영역과 같은 높이를 유지한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApi(page, testRecord());
  let releaseWorkouts!: () => void;
  const workoutGate = new Promise<void>((resolve) => {
    releaseWorkouts = resolve;
  });
  await page.route("**/api/v2/workout-routines/current", async (route) => {
    await workoutGate;
    await route.fulfill({ json: null });
  });
  await page.route("**/api/v1/workouts/history?**", async (route) => {
    await workoutGate;
    await route.fulfill({ json: { items: [testWorkout], nextCursor: null } });
  });

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "내 프로필" })).toBeVisible();
  await page.getByRole("link", { name: "메인", exact: true }).click();
  await expect(page).toHaveURL("/");
  const activity = page.locator(".home-activity");
  await expect(activity.locator(".loading")).toHaveCount(2);
  const before = (await activity.boundingBox())!;

  const responses = Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/workout-routines/current"),
    ),
    page.waitForResponse((response) =>
      response.url().includes("/workouts/history?"),
    ),
  ]);
  releaseWorkouts();
  await responses;
  await expect(
    activity.getByRole("heading", { name: "내 기존 운동" }),
  ).toBeVisible();
  await expect(activity.locator(".loading")).toHaveCount(0);
  const after = (await activity.boundingBox())!;
  expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
});

test("움직임 감소 설정에서는 페이지 진입 애니메이션을 만들지 않는다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "운동", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.entranceCalls)).toEqual([]);
  const duration = await page.getByRole("main").evaluate((element) => {
    const timing = element.getAnimations()[0]?.effect?.getComputedTiming();
    return Number(timing?.duration ?? Infinity);
  });
  expect(duration).toBeLessThanOrEqual(0.1);
});
