import { test, expect } from "@playwright/test";
import { ownedToolOptions } from "../../lib/user-preferences";
import { respectRateLimit } from "./live-api-fixtures";
const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "preferences-live-test-2026!";
let email: string;
let headers: Record<string, string>;
let pageErrors: string[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  email = `preferences-live-${crypto.randomUUID()}@example.test`;
  headers = {
    Origin: new URL(test.info().project.use.baseURL as string).origin,
    "X-CSRF-Protection": "1",
  };
  const response = await respectRateLimit(() =>
    page.request.post(`${api}/auth/register`, {
      headers,
      data: { email, password },
    }),
  );
  expect(response.status()).toBe(201);
  headers.Authorization = `Bearer ${(await response.json()).access_token}`;
});
test.afterEach(async ({ page }) => {
  if (headers.Authorization) {
    const response = await respectRateLimit(() =>
      page.request.delete(`${api}/users/me`, {
        headers,
        data: { password },
      }),
    );
    expect(response.status()).toBe(204);
  }
  expect(pageErrors).toEqual([]);
});

test("실제 API: 운동량·목적·도구 저장, 새로고침·재로그인 복원과 프로필 보존", async ({
  page,
  browser,
}) => {
  const profile = await (
    await page.request.get(`${api}/auth/me`, { headers })
  ).json();
  const initial = await (
    await page.request.get(`${api}/users/me/preferences`, { headers })
  ).json();
  expect(initial).toMatchObject({
    exerciseVolume: "standard",
    exerciseGoal: null,
    ownedTools: [],
  });
  await page.goto("/account");
  await page.getByRole("link", { name: "운동 설정" }).click();
  await expect(
    page.getByRole("radio", { name: "기본", exact: true }),
  ).toBeChecked();
  await page.getByText("가볍게", { exact: true }).click();
  const waiting = page.waitForResponse(
    (response) =>
      response.url() === `${api}/users/me/preferences` &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  const response = await waiting;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ exerciseVolume: "less" });
  expect(await response.json()).toMatchObject({
    exerciseVolume: "less",
    exerciseGoal: null,
  });
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  await page.reload();
  await expect(page.getByRole("radio", { name: "가볍게" })).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "없음", exact: true }),
  ).toBeChecked();
  for (const option of ownedToolOptions)
    await page
      .getByRole("checkbox", { name: option.label, exact: true })
      .check();
  await page.getByText("체형 관리", { exact: true }).click();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  const saved = await (
    await page.request.get(`${api}/users/me/preferences`, { headers })
  ).json();
  expect(saved).toMatchObject({
    exerciseVolume: "less",
    exerciseGoal: "body_composition_management",
    ownedTools: ownedToolOptions.map((option) => option.value),
  });
  expect(Date.parse(saved.updatedAt)).toBeGreaterThan(
    Date.parse(initial.updatedAt),
  );
  expect(
    await (await page.request.get(`${api}/auth/me`, { headers })).json(),
  ).toEqual(profile);
  await page.reload();
  for (const option of ownedToolOptions)
    await expect(
      page.getByRole("checkbox", { name: option.label, exact: true }),
    ).toBeChecked();
  const secondDevice = await browser.newContext();
  try {
    const loginResponse = await secondDevice.request.post(`${api}/auth/login`, {
      headers: { Origin: headers.Origin, "X-CSRF-Protection": "1" },
      data: { email, password },
    });
    expect(loginResponse.status()).toBe(200);
    const secondPage = await secondDevice.newPage();
    await secondPage.goto(`${headers.Origin}/account/preferences`);
    for (const option of ownedToolOptions)
      await expect(
        secondPage.getByRole("checkbox", { name: option.label, exact: true }),
      ).toBeChecked();
  } finally {
    await secondDevice.close();
  }
  await page.getByRole("link", { name: "이전 화면" }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  const login = page.waitForResponse(
    (response) =>
      response.url() === `${api}/auth/login` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  const authenticated = await login;
  expect(authenticated.status()).toBe(200);
  headers.Authorization = `Bearer ${(await authenticated.json()).access_token}`;
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await page.getByRole("link", { name: "운동 설정" }).click();
  await expect(page.getByRole("radio", { name: "가볍게" })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "체형 관리", exact: true }),
  ).toBeChecked();
  for (const option of ownedToolOptions)
    await expect(
      page.getByRole("checkbox", { name: option.label, exact: true }),
    ).toBeChecked();
  await page.getByRole("checkbox", { name: "없음", exact: true }).check();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("운동 설정을 저장했어요.");
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "없음", exact: true }),
  ).toBeChecked();
  expect(
    (
      await (
        await page.request.get(`${api}/users/me/preferences`, { headers })
      ).json()
    ).ownedTools,
  ).toEqual([]);
});

test("실제 API: 두 사용자의 도구 설정 격리와 변경하지 않은 목적 보존", async ({
  page,
  playwright,
}) => {
  const other = await playwright.request.newContext();
  const otherHeaders = {
    Origin: headers.Origin,
    "X-CSRF-Protection": "1",
    Authorization: "",
  };
  try {
    const otherEmail = `preferences-other-${crypto.randomUUID()}@example.test`;
    const registered = await respectRateLimit(() =>
      other.post(`${api}/auth/register`, {
        headers: { Origin: headers.Origin, "X-CSRF-Protection": "1" },
        data: { email: otherEmail, password },
      }),
    );
    expect(registered.status()).toBe(201);
    otherHeaders.Authorization = `Bearer ${(await registered.json()).access_token}`;
    await page.goto("/account/preferences");
    await expect(
      page.getByRole("radio", { name: "기본", exact: true }),
    ).toBeChecked();
    await page.getByText("충분히", { exact: true }).click();
    await page.getByRole("checkbox", { name: "짐볼", exact: true }).check();
    const concurrent = await page.request.patch(`${api}/users/me/preferences`, {
      headers,
      data: { exerciseGoal: "general_fitness_improvement" },
    });
    expect(concurrent.status()).toBe(200);
    await page.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "운동 설정을 저장했어요.",
    );
    await expect(
      page.getByRole("radio", { name: "기본 체력 증진", exact: true }),
    ).toBeChecked();
    const mine = await (
      await page.request.get(`${api}/users/me/preferences`, { headers })
    ).json();
    expect(mine).toMatchObject({
      exerciseVolume: "more",
      exerciseGoal: "general_fitness_improvement",
      ownedTools: ["gym_ball"],
    });
    const theirs = await (
      await other.get(`${api}/users/me/preferences`, { headers: otherHeaders })
    ).json();
    expect(theirs).toMatchObject({
      exerciseVolume: "standard",
      exerciseGoal: null,
      ownedTools: [],
    });
    const changed = await other.patch(`${api}/users/me/preferences`, {
      headers: otherHeaders,
      data: {
        exerciseVolume: "less",
        exerciseGoal: "fitness_grade_improvement",
        ownedTools: ["band"],
      },
    });
    expect(changed.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole("radio", { name: "충분히" })).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "기본 체력 증진", exact: true }),
    ).toBeChecked();
    expect(
      await (
        await page.request.get(`${api}/users/me/preferences`, { headers })
      ).json(),
    ).toEqual(mine);
  } finally {
    if (otherHeaders.Authorization) {
      const removed = await respectRateLimit(() =>
        other.delete(`${api}/users/me`, {
          headers: otherHeaders,
          data: { password },
        }),
      );
      expect(removed.status()).toBe(204);
    }
    await other.dispose();
  }
});
