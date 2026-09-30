import { test, expect } from "@playwright/test";
import { installApi, testRecord, testUser } from "./integration-fixtures";
test("홈·프로필은 서버 스트릭을 사용하고 지원하지 않는 통계와 조회 실패를 0으로 꾸미지 않는다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  let streak = 7,
    fail = false,
    wrongOwner = false;
  await page.route("**/api/v1/users/me/profile/activity", (route) =>
    fail
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: {
            userId: wrongOwner
              ? "99999999-1111-4111-8111-111111111111"
              : testUser.id,
            nickname: null,
            profileCharacter: null,
            streak,
            longestStreak: 12,
            totalWorkoutDays: 30,
          },
        }),
  );
  await page.goto("/");
  await expect(page.getByRole("region", { name: "연속 운동" })).toContainText(
    "7일 연속 운동 중",
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "내 프로필" })
    .click();
  const report = page.getByRole("region", { name: "활동 리포트" });
  await expect(report.locator("dd").first()).toHaveText("7일");
  await expect(report.getByText("집계 준비 중", { exact: true })).toHaveCount(
    2,
  );
  await expect(report.locator("dd").nth(1)).toHaveText("12일");
  await expect(report.locator("dd").nth(4)).toHaveText("30일");
  streak = 8;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(report.locator("dd").first()).toHaveText("8일");
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(report.getByRole("alert")).toBeVisible();
  await expect(report.locator("dd").first()).toHaveText("—확인 필요");
  fail = false;
  await report.getByRole("button", { name: "활동 정보 다시 불러오기" }).click();
  await expect(report.locator("dd").first()).toHaveText("8일");
  wrongOwner = true;
  await page.reload();
  await expect(report.getByRole("alert")).toContainText(
    "서버 응답을 확인할 수 없어요",
  );
  await expect(report.locator("dd").first()).not.toHaveText("8일");
});
