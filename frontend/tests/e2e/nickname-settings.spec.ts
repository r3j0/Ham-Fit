import { test, expect, type Page } from "@playwright/test";
import { installApi, testUser } from "./integration-fixtures";

function profileState() {
  return {
    profile: {
      nickname: "건강친구" as string | null,
      dateOfBirth: "2000-02-29",
      currentAge: 26,
    },
    patches: [] as Record<string, string>[],
    readFailure: false,
    malformed: false,
    saveFailure: 0,
    hold: null as Promise<void> | null,
  };
}
async function installProfile(
  page: Page,
  state: ReturnType<typeof profileState>,
) {
  await installApi(page);
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      json: {
        ...testUser,
        ...state.profile,
        isOnboarded: false,
        currency: { balance: 7 },
        currentCurriculum: null,
      },
    }),
  );
  await page.route("**/users/me/profile", async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON();
      state.patches.push(patch);
      expect(route.request().headers()["x-csrf-protection"]).toBe("1");
      expect(Object.keys(patch)).toHaveLength(1);
      if (state.hold) await state.hold;
      if (state.saveFailure)
        return route.fulfill({
          status: state.saveFailure,
          headers:
            state.saveFailure === 429
              ? {
                  "Retry-After": "1",
                  "Access-Control-Expose-Headers": "Retry-After",
                }
              : {},
          json:
            state.saveFailure === 400
              ? {
                  code: "INVALID_NICKNAME",
                  errors: [
                    {
                      field: "nickname",
                      message: "서버가 닉네임을 거절했어요.",
                    },
                  ],
                }
              : { message: "Temporary failure" },
        });
      state.profile = { ...state.profile, ...patch };
    } else if (state.readFailure)
      return route.fulfill({
        status: 503,
        json: { message: "Temporary failure" },
      });
    return route.fulfill({
      json: state.malformed
        ? { dateOfBirth: null, currentAge: null }
        : state.profile,
    });
  });
}

test("닉네임만 저장하고 다른 창의 프로필과 새로고침에 반영하며 세션·생년월일을 유지한다", async ({
  page,
}, info) => {
  const state = profileState();
  await installProfile(page, state);
  const other = await page.context().newPage();
  await installProfile(other, state);
  await other.goto("/account");
  await expect(
    other.getByRole("heading", { name: "건강친구", exact: true }),
  ).toBeVisible();
  await page.goto("/account/settings");
  await expect(page.getByRole("group", { name: "설정 항목" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "생년월일",
    "닉네임 변경",
    "이메일 변경",
    "비밀번호 변경",
    "회원 탈퇴",
  ]);
  await expect(page.getByLabel("생년월일 입력")).toBeVisible();
  const nickname = page.getByLabel("닉네임", { exact: true });
  await expect(nickname).toHaveValue("건강친구");
  await expect(page.getByLabel("현재 비밀번호")).toHaveCount(3);
  await nickname.fill("  새이름_2  ");
  await page.getByRole("button", { name: "닉네임 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("닉네임을 저장했어요.");
  expect(state.patches).toEqual([{ nickname: "새이름_2" }]);
  expect(state.profile.dateOfBirth).toBe("2000-02-29");
  await expect(
    other.getByRole("heading", { name: "새이름_2", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(nickname).toHaveValue("새이름_2");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    for (const name of [
      "이메일 변경",
      "비밀번호 변경",
      "생년월일",
      "닉네임 변경",
      "회원 탈퇴",
    ])
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`nickname-${width}.png`) });
  }
  state.profile.nickname = "가".repeat(20);
  await other.setViewportSize({ width: 320, height: 844 });
  await other.reload();
  await expect(
    other.getByRole("heading", { name: state.profile.nickname, exact: true }),
  ).toBeVisible();
  expect(
    await other.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await other.close();
});

test("섹션을 이동해도 생년월일·닉네임·계정 입력을 보존하고 이탈 확인은 한 번만 한다", async ({
  page,
}) => {
  const state = profileState();
  await installProfile(page, state);
  await page.goto("/account/settings?tab=birth");
  await page.getByLabel("생년월일 입력").fill("1999-03-01");
  await page
    .getByRole("heading", { name: "닉네임 변경", exact: true })
    .scrollIntoViewIfNeeded();
  await page.getByLabel("닉네임", { exact: true }).fill("입력보존");
  await page
    .getByRole("heading", { name: "이메일 변경", exact: true })
    .scrollIntoViewIfNeeded();
  await page.getByLabel("새 이메일").fill("draft@example.test");
  let prompts = 0;
  const cancel = async (dialog: import("@playwright/test").Dialog) => {
    prompts++;
    await dialog.dismiss();
  };
  page.on("dialog", cancel);
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  expect(prompts).toBe(1);
  await expect(page.getByLabel("새 이메일")).toHaveValue("draft@example.test");
  await page
    .getByRole("heading", { name: "생년월일", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByLabel("생년월일 입력")).toHaveValue("1999-03-01");
  await page.getByRole("button", { name: "생년월일 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("생년월일을 저장했어요.");
  expect(state.patches).toEqual([{ dateOfBirth: "1999-03-01" }]);
  expect(state.profile.nickname).toBe("건강친구");
  await page
    .getByRole("heading", { name: "닉네임 변경", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue(
    "입력보존",
  );
  page.off("dialog", cancel);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL("/account");
});

test("조회·계약 오류와 잘못된 입력·서버 거절·요청 제한은 입력을 유지하고 명시적으로 재시도한다", async ({
  page,
}) => {
  const state = profileState();
  state.readFailure = true;
  await installProfile(page, state);
  await page.goto("/account/settings?tab=nickname");
  const retry = page.getByRole("button", { name: "닉네임 다시 불러오기" });
  await expect(retry).toBeVisible();
  state.readFailure = false;
  state.malformed = true;
  await retry.click();
  await expect(
    page.locator("#settings-nickname").getByRole("alert"),
  ).toContainText("닉네임 응답을 확인하지 못했어요");
  state.malformed = false;
  await retry.click();
  const nickname = page.getByLabel("닉네임", { exact: true });
  const save = page.getByRole("button", { name: "닉네임 저장" });
  await expect(nickname).toHaveValue("건강친구");
  for (const value of ["가", "가".repeat(21), "건강 친구", "친구🙂"]) {
    await nickname.fill(value);
    await save.click();
    await expect(nickname).toHaveAttribute("aria-invalid", "true");
  }
  expect(state.patches).toHaveLength(0);
  await nickname.fill("다시시도");
  state.saveFailure = 400;
  await save.click();
  await expect(
    page.locator("#settings-nickname").getByRole("alert"),
  ).toContainText("서버가 닉네임을 거절했어요");
  await expect(nickname).toHaveValue("다시시도");
  state.saveFailure = 429;
  await save.click();
  await expect(
    page.getByRole("button", { name: /초 후 다시 시도/ }),
  ).toBeDisabled();
  await expect(save).toBeEnabled();
  state.saveFailure = 503;
  await save.click();
  await expect(
    page.locator("#settings-nickname").getByRole("alert"),
  ).toContainText("서버가 잠시 응답하지 않아요");
  await expect(nickname).toHaveValue("다시시도");
  expect(state.patches).toHaveLength(3);
  state.saveFailure = 0;
  await save.click();
  await expect(page.getByRole("status")).toHaveText("닉네임을 저장했어요.");
  expect(state.patches).toHaveLength(4);
});

test("저장 중 다른 변경·중복 제출을 막고 계정 전환 후 늦은 응답을 적용하지 않는다", async ({
  page,
}) => {
  const state = profileState();
  let release = () => {};
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await installProfile(page, state);
  await page.goto("/account/settings?tab=nickname");
  await page.getByLabel("닉네임", { exact: true }).fill("저장중이름");
  await page.getByRole("button", { name: "닉네임 저장" }).click();
  await expect(
    page
      .getByRole("form", { name: "이메일 변경", exact: true })
      .getByRole("button", { name: "이메일 변경", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("닉네임", { exact: true })).toBeDisabled();
  expect(state.patches).toHaveLength(1);
  await page.evaluate(() => {
    const channel = new BroadcastChannel("modu-auth-session");
    channel.postMessage({ type: "logout", reason: "expired" });
    channel.close();
  });
  await expect(page).toHaveURL(/\/login/);
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/users/me/profile") &&
      response.request().method() === "PATCH",
  );
  release();
  await completed;
  await expect(page.getByText("닉네임을 저장했어요.")).toHaveCount(0);
});
