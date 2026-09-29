import { test, expect, type Page } from "@playwright/test";
const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "group-live-test-password-2026!";
async function user(page: Page, nickname: string) {
  const headers = {
    Origin: new URL(test.info().project.use.baseURL as string).origin,
    "X-CSRF-Protection": "1",
    Authorization: "",
  };
  const response = await page.request.post(`${api}/auth/register`, {
    headers,
    data: { email: `group-${crypto.randomUUID()}@example.test`, password },
  });
  expect(response.status()).toBe(201);
  const auth = await response.json();
  headers.Authorization = `Bearer ${auth.access_token}`;
  expect(
    (
      await page.request.patch(`${api}/users/me/profile`, {
        headers,
        data: { nickname },
      })
    ).status(),
  ).toBe(200);
  return { headers, id: auth.user.id as string };
}
test("실제 API: 생성·초대·승인/거절·멤버 조회·강퇴·위임·탈퇴·삭제 및 그룹장 계정 탈퇴 제한", async ({
  page,
  browser,
}, info) => {
  const origin = new URL(info.project.use.baseURL as string).origin;
  const otherContext = await browser.newContext(),
    other = await otherContext.newPage();
  const leader = await user(page, "함께걷기"),
    member = await user(other, "꾸준한운동");
  let groupId = "";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  other.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/groups");
    await page.getByLabel("그룹 이름", { exact: true }).fill("건강한 하루");
    await page
      .getByLabel("그룹 소개", { exact: true })
      .fill("매일 함께 움직여요");
    await page.getByLabel("정원", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "그룹 만들기", exact: true })
      .click();
    await expect(page).toHaveURL(/\/groups\/[a-f0-9-]+$/);
    groupId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(
      page.getByRole("heading", { name: "건강한 하루" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "그룹 설정" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("그룹 소개")
      .fill("작은 운동을 꾸준히");
    expect(
      (
        await page.request.patch(`${api}/groups/${groupId}`, {
          headers: leader.headers,
          data: { name: "함께하는 하루" },
        })
      ).status(),
    ).toBe(200);
    const updated = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/groups/${groupId}`) &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "그룹 정보 저장" }).click();
    expect((await updated).request().postDataJSON()).toEqual({
      description: "작은 운동을 꾸준히",
    });
    await expect(
      page.getByRole("heading", { name: "함께하는 하루" }),
    ).toBeVisible();
    await expect(
      page.getByText("작은 운동을 꾸준히", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "초대 코드 보기" }).click();
    const code = await page.getByLabel("그룹 초대 코드").inputValue();
    expect(code).toMatch(/^[\w-]{43}$/);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`group-${width}.png`),
        fullPage: true,
      });
    }
    await other.goto(`${origin}/groups`);
    await other.getByLabel("초대 코드", { exact: true }).fill(code);
    await other.getByRole("button", { name: "가입 신청하기" }).click();
    await expect(
      other.getByText("가입을 신청했어요.", { exact: false }),
    ).toBeVisible();
    await other.reload();
    await expect(other.getByText("아직 가입한 그룹이 없어요.")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "가입 거절" }).click();
    await expect(
      page
        .getByRole("group", { name: "신청 상태" })
        .getByRole("button", { name: "거절", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "가입 신청 관리" }),
    ).not.toContainText("꾸준한운동");
    await other.getByLabel("초대 코드", { exact: true }).fill(code);
    await other.getByRole("button", { name: "가입 신청하기" }).click();
    await expect(
      other.getByText("가입을 신청했어요.", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("group", { name: "신청 상태" })
      .getByRole("button", { name: "대기", exact: true })
      .click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "가입 승인" }).click();
    await expect(
      page.getByRole("region", { name: "그룹원", exact: true }),
    ).toContainText("꾸준한운동");
    await other.goto(`${origin}/groups/${groupId}`);
    await other.getByRole("button", { name: "그룹 설정" }).click();
    await expect(other.getByRole("dialog").getByLabel("그룹 이름")).toHaveCount(
      0,
    );
    await expect(other.getByRole("button", { name: "그룹 삭제" })).toHaveCount(
      0,
    );
    await other.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(
      other.getByRole("region", { name: "가입 신청 관리" }),
    ).toHaveCount(0);
    await other.getByRole("link", { name: "그룹장 함께걷기" }).click();
    await expect(
      other.getByRole("heading", { name: "그룹원 프로필" }),
    ).toBeVisible();
    await expect(
      other.getByText("연속 운동 0일", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await other.request.patch(`${api}/groups/${groupId}`, {
          headers: member.headers,
          data: { name: "권한없음" },
        })
      ).status(),
    ).toBe(403);
    await page.goto("/account/settings?tab=delete");
    await page.getByLabel("현재 비밀번호", { exact: true }).fill(password);
    await page
      .getByRole("form", { name: "회원 탈퇴" })
      .getByRole("button", { name: "회원 탈퇴", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "영구 탈퇴" })
      .click();
    await expect(
      page.getByRole("link", { name: "내 그룹 관리하기" }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).not.toContainText(
      "이메일",
    );
    page.on("dialog", (d) => d.accept());
    await page.goto(`/groups/${groupId}`);
    await page.getByRole("button", { name: "꾸준한운동 관리" }).click();
    await page.getByRole("button", { name: "내보내기", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "확인", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "그룹원", exact: true }),
    ).not.toContainText("꾸준한운동");
    await other.goto(`${origin}/groups/${groupId}`);
    await expect(other.getByRole("main").getByRole("alert")).toBeVisible();
    await other.goto(`${origin}/groups`);
    await other.getByLabel("초대 코드", { exact: true }).fill(code);
    await other.getByRole("button", { name: "가입 신청하기" }).click();
    await expect(
      other.getByText("가입을 신청했어요.", { exact: false }),
    ).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "가입 승인" }).click();
    await page.getByRole("button", { name: "꾸준한운동 관리" }).click();
    await page.getByRole("button", { name: "그룹장 위임" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "확인", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "그룹 삭제" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "그룹 설정" }).click();
    await page.getByRole("button", { name: "그룹 탈퇴", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "확인", exact: true })
      .click();
    await expect(page).toHaveURL("/groups");
    await other.goto(`${origin}/groups/${groupId}`);
    await other.getByRole("button", { name: "그룹 설정" }).click();
    await other.getByRole("button", { name: "그룹 삭제" }).click();
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "확인", exact: true })
      .click();
    await expect(other).toHaveURL(`${origin}/groups`);
    groupId = "";
    expect(errors).toEqual([]);
  } finally {
    if (groupId) {
      await page.request.delete(`${api}/groups/${groupId}`, {
        headers: leader.headers,
      });
      await other.request.delete(`${api}/groups/${groupId}`, {
        headers: member.headers,
      });
    }
    expect(
      (
        await page.request.delete(`${api}/users/me`, {
          headers: leader.headers,
          data: { password },
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await other.request.delete(`${api}/users/me`, {
          headers: member.headers,
          data: { password },
        })
      ).status(),
    ).toBe(204);
    await otherContext.close();
  }
});
