import { test, expect } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";

test("저장 완료 화면은 새로고침해도 기록을 확인하고 두 가지 다음 행동만 제공한다", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const record = testRecord();
  const server = await installApi(page, record);
  await page.goto(`/onboarding/complete?record=${record.id}`);
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "새 체력 기록 시작" }),
  ).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    "3단계 중 3단계, 체력 기록 완료",
  );
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`complete-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "측정 기록 보기", exact: true }).click();
  await expect(page).toHaveURL(`/measurements/${record.id}?saved=1`);
  expect(server.mutations).toHaveLength(0);
});

test("기록이 없거나 확인에 실패하면 저장 완료를 표시하지 않고 재시도한다", async ({
  page,
}) => {
  const record = testRecord();
  const server = await installApi(page, record);
  await page.goto("/onboarding/complete");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "확인할 기록이 없어요",
  );
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toHaveCount(0);
  await page.route(`**/measurements/${record.id}`, (route) =>
    route.fulfill({ status: 503, json: { message: "Temporary failure" } }),
  );
  await page.goto(`/onboarding/complete?record=${record.id}`);
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toHaveCount(0);
  await page.unroute(`**/measurements/${record.id}`);
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "메인으로", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(server.mutations).toHaveLength(0);
});
