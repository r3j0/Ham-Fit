import { expect, test } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";

type EntranceCall = {
  directChild: boolean;
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
        window.entranceCalls.push({
          directChild: this.parentElement?.matches("main") ?? false,
          id,
        });
      }
      return animate.call(this, keyframes, options);
    };
  });
});

test("페이지 진입은 최상위 영역만 합성 애니메이션하고 이후 갱신에서 재시작하지 않는다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "운동", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.entranceCalls.length))
    .toBeGreaterThan(0);

  const initial = await page.evaluate(() => [...window.entranceCalls]);
  expect(initial.length).toBeLessThanOrEqual(2);
  expect(initial.every(({ directChild }) => directChild)).toBe(true);

  await page.getByRole("button", { name: "이전 달", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2026년 8월" })).toBeVisible();
  expect(await page.evaluate(() => window.entranceCalls)).toEqual(initial);
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
});
