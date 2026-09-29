import { test, expect } from "@playwright/test";
const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
test("실제 알림: 신청·거절·승인 알림과 읽음 상태를 계정별로 저장한다", async ({
  page,
  browser,
}, info) => {
  const origin = new URL(info.project.use.baseURL as string).origin,
    password = "notification-live-password-2026!";
  const otherContext = await browser.newContext(),
    other = await otherContext.newPage();
  const headers = {
      Origin: origin,
      "X-CSRF-Protection": "1",
      Authorization: "",
    },
    otherHeaders = { ...headers };
  let groupId = "";
  try {
    for (const [client, h] of [
      [page.request, headers],
      [other.request, otherHeaders],
    ] as const) {
      const r = await client.post(`${api}/auth/register`, {
        headers: h,
        data: {
          email: `notification-${crypto.randomUUID()}@example.test`,
          password,
        },
      });
      expect(r.status()).toBe(201);
      h.Authorization = `Bearer ${(await r.json()).access_token}`;
    }
    const created = await page.request.post(`${api}/groups`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { name: "알림 검증", description: "", maxMembers: 3 },
    });
    expect(created.status()).toBe(201);
    groupId = (await created.json()).id;
    const { inviteCode } = await (
      await page.request.get(`${api}/groups/${groupId}/invite-code`, {
        headers,
      })
    ).json();
    async function apply() {
      const r = await other.request.post(`${api}/groups/join-requests`, {
        headers: { ...otherHeaders, "Idempotency-Key": crypto.randomUUID() },
        data: { inviteCode },
      });
      expect(r.status()).toBe(201);
      return (await r.json()).id as string;
    }
    const first = await apply();
    await page.goto("/account/notifications");
    await expect(
      page.getByText("새 그룹 가입 신청이 도착했어요."),
    ).toBeVisible();
    const inbox = await (
      await page.request.get(`${api}/notifications`, { headers })
    ).json();
    expect(
      (
        await other.request.patch(
          `${api}/notifications/${inbox.items[0].id}/read`,
          { headers: otherHeaders },
        )
      ).status(),
    ).toBe(404);
    await page.getByRole("button", { name: "읽음으로 표시" }).click();
    await expect(page.getByText("새 그룹 가입 신청이 도착했어요.")).toHaveCount(
      0,
    );
    await expect(page.getByText("아직 알림이 없어요.")).toBeVisible();
    expect(
      (
        await (
          await page.request.get(`${api}/notifications`, { headers })
        ).json()
      ).items[0].readAt,
    ).not.toBeNull();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "읽음으로 표시" }),
    ).toHaveCount(0);
    await expect(page.getByRole("listitem")).toHaveCount(0);
    expect(
      (
        await page.request.post(
          `${api}/groups/${groupId}/join-requests/${first}/reject`,
          { headers },
        )
      ).status(),
    ).toBe(200);
    await other.goto(`${origin}/account/notifications`);
    await expect(other.getByText("그룹 가입 신청이 거절됐어요.")).toBeVisible();
    await expect(
      other.getByRole("link", { name: "내 그룹 보기" }),
    ).toHaveAttribute("href", "/groups");
    const second = await apply();
    expect(
      (
        await page.request.post(
          `${api}/groups/${groupId}/join-requests/${second}/approve`,
          { headers },
        )
      ).status(),
    ).toBe(200);
    await other.getByRole("button", { name: "알림 새로고침" }).click();
    await expect(other.getByText("그룹 가입이 승인됐어요.")).toBeVisible();
    await expect(
      other.getByRole("link", { name: "그룹 보기", exact: true }),
    ).toHaveAttribute("href", `/groups/${groupId}`);
    const approved = other
      .getByRole("listitem")
      .filter({ hasText: "그룹 가입이 승인됐어요." });
    await approved.getByRole("button", { name: "읽음으로 표시" }).click();
    await expect(approved).toHaveCount(0);
    await other.reload();
    await expect(approved).toHaveCount(0);
    await expect(other.getByText("그룹 가입 신청이 거절됐어요.")).toBeVisible();
    await other.setViewportSize({ width: 320, height: 800 });
    expect(
      await other.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await other.screenshot({
      path: info.outputPath("notifications-320.png"),
      fullPage: true,
    });
  } finally {
    if (groupId)
      await page.request.delete(`${api}/groups/${groupId}`, { headers });
    for (const [client, h] of [
      [page.request, headers],
      [other.request, otherHeaders],
    ] as const) {
      if (h.Authorization)
        expect(
          (
            await client.delete(`${api}/users/me`, {
              headers: h,
              data: { password },
            })
          ).status(),
        ).toBe(204);
    }
    await otherContext.close();
  }
});
