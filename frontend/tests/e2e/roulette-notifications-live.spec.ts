import { expect, test, type Page } from "@playwright/test";
const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "roulette-notifications-live-test-2026!";
async function register(page: Page, origin: string) {
  const headers = {
    Origin: origin,
    "X-CSRF-Protection": "1",
    Authorization: "",
  };
  const response = await page.request.post(`${api}/auth/register`, {
    headers,
    data: {
      email: `roulette-${crypto.randomUUID()}@example.test`,
      password,
      nickname: "알림검증",
      dateOfBirth: "2000-01-01",
    },
  });
  expect(response.status(), JSON.stringify(await response.json())).toBe(201);
  const auth = await response.json();
  headers.Authorization = `Bearer ${auth.access_token}`;
  return headers;
}
test("실제 API: 개인·그룹 0회 진입점과 미션 시작 직후 참여자 물 횟수를 표시한다", async ({
  page,
  browser,
}, info) => {
  const origin = new URL(info.project.use.baseURL as string).origin;
  const context = await browser.newContext(),
    other = await context.newPage();
  const owner = await register(page, origin),
    member = await register(other, origin);
  let groupId = "";
  try {
    const response = await page.request.post(`${api}/groups`, {
      headers: { ...owner, "Idempotency-Key": crypto.randomUUID() },
      data: {
        name: "[TEST ONLY] 룰렛 알림",
        description: "검증 후 삭제",
        maxMembers: 3,
      },
    });
    expect(response.status()).toBe(201);
    groupId = (await response.json()).id;
    const invite = await (
      await page.request.get(`${api}/groups/${groupId}/invite-code`, {
        headers: owner,
      })
    ).json();
    const apply = await other.request.post(`${api}/groups/join-requests`, {
      headers: { ...member, "Idempotency-Key": crypto.randomUUID() },
      data: { inviteCode: invite.inviteCode },
    });
    expect(apply.status()).toBe(201);
    const application = await apply.json();
    expect(
      (
        await page.request.post(
          `${api}/groups/${groupId}/join-requests/${application.id}/approve`,
          { headers: owner },
        )
      ).status(),
    ).toBe(200);
    await page.goto(`/groups/${groupId}`);
    const members = page.getByRole("region", { name: "그룹원", exact: true });
    await expect(
      members.locator("[aria-label^='현재 미션 물 주기']"),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "새 미션 시작", exact: true })
      .click();
    await page.getByRole("button", { name: "미션 시작", exact: true }).click();
    await expect(members.getByLabel("현재 미션 물 주기 0회")).toHaveCount(2);
    await page.reload();
    await expect(members.getByLabel("현재 미션 물 주기 0회")).toHaveCount(2);
    for (const width of [390, 1218]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({
        path: info.outputPath(`live-member-water-${width}.png`),
        fullPage: true,
      });
    }
    const tickets = await page.request.get(
      `${api}/users/me/streak-roulette/tickets?limit=1`,
      { headers: owner },
    );
    expect(tickets.status()).toBe(200);
    expect((await tickets.json()).availableCount).toBe(0);
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "개인 룰렛", exact: true }),
    ).toHaveCount(0);
    await page.goto(`/groups/${groupId}`);
    await expect(page.getByLabel("그룹 룰렛 사용 가능 횟수")).toHaveText("0회");
    await expect(
      page
        .getByRole("region", { name: "그룹 룰렛", exact: true })
        .getByRole("button", { name: "룰렛 돌리기" }),
    ).toBeDisabled();
    await page.goto("/account/notifications");
    await expect(page.getByRole("region", { name: /룰렛/ })).toHaveCount(0);
  } finally {
    if (groupId)
      expect(
        (
          await page.request.delete(`${api}/groups/${groupId}`, {
            headers: owner,
          })
        ).status(),
      ).toBe(204);
    expect(
      (
        await page.request.delete(`${api}/users/me`, {
          headers: owner,
          data: { password },
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await other.request.delete(`${api}/users/me`, {
          headers: member,
          data: { password },
        })
      ).status(),
    ).toBe(204);
    await context.close();
  }
});
