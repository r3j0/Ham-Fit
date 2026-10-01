import { test, expect } from "@playwright/test";
const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "nickname-live-validation-password-2026!";

test("실제 PR #9 닉네임 저장·재조회·프로필 표시·생년월일 부분 수정은 세션과 다른 정보를 보존한다", async ({
  page,
}) => {
  const headers: Record<string, string> = {
    Origin: new URL(test.info().project.use.baseURL as string).origin,
    "X-CSRF-Protection": "1",
  };
  const registered = await page.request.post(`${api}/auth/register`, {
    headers,
    data: {
      email: `nickname-live-${crypto.randomUUID()}@example.test`,
      password,
      dateOfBirth: "2000-02-29",
      nickname: "연동검증",
    },
  });
  expect(registered.status()).toBe(201);
  headers.Authorization = `Bearer ${(await registered.json()).access_token}`;
  try {
    const before = await (
      await page.request.get(`${api}/auth/me`, { headers })
    ).json();
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "연동검증", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "계정 설정", exact: true }).click();
    await page
      .getByRole("heading", { name: "닉네임 변경", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByLabel("닉네임", { exact: true }).fill("  건강_친구2  ");
    const waiting = page.waitForResponse(
      (r) =>
        r.url().endsWith("/users/me/profile") &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "닉네임 저장" }).click();
    const saved = await waiting;
    expect(saved.status()).toBe(200);
    expect(saved.request().postDataJSON()).toEqual({ nickname: "건강_친구2" });
    expect(await saved.json()).toMatchObject({
      nickname: "건강_친구2",
      dateOfBirth: "2000-02-29",
    });
    await expect(page.getByRole("status")).toHaveText("닉네임을 저장했어요.");
    await page.reload();
    await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue(
      "건강_친구2",
    );
    await page
      .getByRole("heading", { name: "생년월일", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByLabel("생년월일 입력").fill("1999-03-01");
    const birthWaiting = page.waitForResponse(
      (r) =>
        r.url().endsWith("/users/me/profile") &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "생년월일 저장" }).click();
    const birthSaved = await birthWaiting;
    expect(birthSaved.status()).toBe(200);
    expect(birthSaved.request().postDataJSON()).toEqual({
      dateOfBirth: "1999-03-01",
    });
    expect(await birthSaved.json()).toMatchObject({
      nickname: "건강_친구2",
      dateOfBirth: "1999-03-01",
    });
    await expect(page.getByRole("status")).toHaveText("생년월일을 저장했어요.");
    await page.getByRole("link", { name: "이전 화면", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "건강_친구2", exact: true }),
    ).toBeVisible();
    const result = await page.request.get(`${api}/auth/me`, { headers });
    expect(result.status()).toBe(200);
    const after = await result.json();
    for (const key of [
      "id",
      "email",
      "isOnboarded",
      "currency",
      "currentCurriculum",
      "created_at",
    ])
      expect(after[key]).toEqual(before[key]);
    expect(after.nickname).toBe("건강_친구2");
  } finally {
    const cleanup = await page.request.delete(`${api}/users/me`, {
      headers,
      data: { password },
    });
    expect(cleanup.status()).toBe(204);
  }
});
