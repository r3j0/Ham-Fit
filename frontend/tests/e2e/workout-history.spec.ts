import { test, expect } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";

test.use({ timezoneId: "Asia/Seoul" });
const previewDate = new Date("2026-09-27T12:00:00+09:00");

test("달력 체크가 메인 스트릭에 반영되며 새로고침하면 예시로 초기화되고 API에는 저장하지 않는다", async ({
  page,
}) => {
  const api = await installApi(page, testRecord());
  await page.clock.setFixedTime(previewDate);
  await page.goto("/");
  const streak = page.getByRole("region", { name: "운동 스트릭" });
  await expect(streak).toContainText("3일 연속 운동 중");
  await expect(streak.getByRole("listitem")).toHaveCount(7);
  await streak.getByRole("link", { name: "운동 기록 보기" }).click();
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await expect(page.locator(".page-header .mini-brand")).toHaveCount(0);
  await expect(calendar.getByText("예시 기록", { exact: true })).toBeVisible();
  await expect(
    calendar.getByText("예시 기록이며, 새로고침하면 초기화돼요."),
  ).toBeVisible();
  await calendar.getByRole("button", { name: "운동함으로 체크" }).click();
  await expect(
    calendar.getByRole("button", {
      name: "9월 27일 오늘, 운동함",
      exact: true,
    }),
  ).toHaveAttribute("data-completed", "true");
  const navigation = page.getByRole("navigation", { name: "하단 메뉴" });
  await navigation.getByRole("link", { name: "메인", exact: true }).click();
  await expect(streak).toContainText("4일 연속 운동 중");
  await expect(streak).toContainText("오늘도 운동 체크 완료!");
  await streak.getByRole("link", { name: "운동 기록 보기" }).click();
  await calendar
    .getByRole("button", { name: "9월 26일, 운동함", exact: true })
    .click();
  await calendar.getByRole("button", { name: "체크 해제" }).click();
  await navigation.getByRole("link", { name: "메인", exact: true }).click();
  await expect(streak).toContainText("1일 연속 운동 중");
  await streak.getByRole("link", { name: "운동 기록 보기" }).click();
  await calendar.getByRole("button", { name: "체크 해제" }).click();
  await navigation.getByRole("link", { name: "메인", exact: true }).click();
  await expect(streak).toContainText("0일 연속 운동 중");
  await page.reload();
  await expect(streak).toContainText("3일 연속 운동 중");
  expect(api.mutations).toEqual([]);
});

test("달력은 이전 달과 빈 달을 탐색하고 키보드로 체크하며 미래 기록은 막는다", async ({
  page,
}) => {
  const api = await installApi(page, testRecord());
  await page.clock.setFixedTime(previewDate);
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
  await calendar.getByRole("button", { name: "이전 달" }).click();
  await expect(calendar.getByText("0일 운동했어요")).toBeVisible();
  const date = calendar.getByRole("button", {
    name: "7월 15일, 운동 안 함",
    exact: true,
  });
  await date.focus();
  await page.keyboard.press("Enter");
  await expect(date).toHaveAttribute("aria-pressed", "true");
  await calendar.getByRole("button", { name: "운동함으로 체크" }).focus();
  await page.keyboard.press("Enter");
  await expect(calendar.getByText("1일 운동했어요")).toBeVisible();
  await expect(
    calendar.getByRole("button", { name: "7월 15일, 운동함", exact: true }),
  ).toHaveAttribute("data-completed", "true");
  await calendar.getByRole("button", { name: "다음 달" }).click();
  await calendar.getByRole("button", { name: "이전 달" }).click();
  await expect(
    calendar.getByRole("button", { name: "7월 15일, 운동함", exact: true }),
  ).toBeVisible();
  await calendar.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(
    calendar.getByRole("heading", { name: "2026년 9월" }),
  ).toBeVisible();
  await expect(
    calendar.getByRole("button", {
      name: "9월 27일 오늘, 운동 안 함",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(api.mutations).toEqual([]);
});

for (const width of [320, 390, 430, 1280]) {
  test(`${width}px 스트릭과 달력은 화면을 넘치지 않고 모든 날짜를 표시한다`, async ({
    page,
  }, info) => {
    await installApi(page, testRecord());
    await page.clock.setFixedTime(previewDate);
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
