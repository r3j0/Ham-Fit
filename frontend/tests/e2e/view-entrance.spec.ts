import { expect, test } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";

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
