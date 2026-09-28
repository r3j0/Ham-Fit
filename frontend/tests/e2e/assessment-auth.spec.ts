import { test, expect } from "@playwright/test";
import { installApi, testUser } from "./integration-fixtures";

test("인증 만료 후 재로그인하면 간이측정 모드로 돌아간다", async ({ page }) => {
  await installApi(page);
  let authenticated = false;
  const auth = {
    user: testUser,
    access_token: "test-token",
    expires_in: 900,
    token_type: "Bearer",
  };
  await page.route("**/auth/refresh", (route) =>
    route.fulfill(
      authenticated
        ? { json: auth }
        : { status: 401, json: { message: "Expired" } },
    ),
  );
  await page.route("**/auth/login", (route) => {
    authenticated = true;
    return route.fulfill({ json: auth });
  });
  await page.goto("/workout?mode=assessment");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkout%3Fmode%3Dassessment$/);
  await page.getByLabel("이메일", { exact: true }).fill(testUser.email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("contract-test-password!");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL("/workout?mode=assessment");
  await expect(page.getByLabel("만 나이", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "내 기존 운동" })).toHaveCount(
    0,
  );
});
