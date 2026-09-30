import { expect, test, type Page } from "@playwright/test";
import { respectRateLimit } from "./live-api-fixtures";

const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "home-groups-live-password-2026!";
async function account(page: Page, origin: string, nickname: string) {
  const response = await respectRateLimit(() =>
    page.request.post(`${api}/auth/register`, {
      headers: { Origin: origin, "X-CSRF-Protection": "1" },
      data: {
        email: `home-group-${crypto.randomUUID()}@example.test`,
        password,
      },
    }),
  );
  expect(response.status()).toBe(201);
  const auth = await response.json();
  const headers = {
    Origin: origin,
    "X-CSRF-Protection": "1",
    Authorization: `Bearer ${auth.access_token}`,
  };
  const profile = await page.request.patch(`${api}/users/me/profile`, {
    headers,
    data: { nickname },
  });
  if (profile.status() !== 200)
    await page.request.delete(`${api}/users/me`, {
      headers,
      data: { password },
    });
  expect(profile.status()).toBe(200);
  return headers;
}

test("실제 API: 가입한 두 그룹의 멤버·닉네임을 표시하고 탈퇴·삭제 이후 갱신한다", async ({
  page,
  browser,
}, info) => {
  const origin = new URL(info.project.use.baseURL as string).origin;
  const context = await browser.newContext(),
    other = await context.newPage();
  const leader = await account(page, origin, "슬라이드그룹장"),
    member = await account(other, origin, "실제운동친구");
  const ids: string[] = [];
  try {
    for (const name of ["함께하는 첫 그룹", "함께하는 두 번째 그룹"]) {
      const response = await page.request.post(`${api}/groups`, {
        headers: { ...leader, "Idempotency-Key": crypto.randomUUID() },
        data: { name, description: "실제 API 검사 전용", maxMembers: 5 },
      });
      expect(response.status()).toBe(201);
      ids.push((await response.json()).id);
    }
    const invite = await (
      await page.request.get(`${api}/groups/${ids[1]}/invite-code`, {
        headers: leader,
      })
    ).json();
    const request = await other.request.post(`${api}/groups/join-requests`, {
      headers: { ...member, "Idempotency-Key": crypto.randomUUID() },
      data: { inviteCode: invite.inviteCode },
    });
    expect(request.status()).toBe(201);
    expect(
      (
        await page.request.post(
          `${api}/groups/${ids[1]}/join-requests/${(await request.json()).id}/approve`,
          { headers: leader },
        )
      ).status(),
    ).toBe(200);
    await page.goto("/");
    const region = page.getByRole("region", { name: "내 그룹의 햄스터" });
    await expect(region.getByRole("link")).toHaveAttribute(
      "href",
      /\/groups\/[a-f0-9-]+$/,
    );
    if (
      (await region.getByRole("link").getAttribute("href")) !==
      `/groups/${ids[1]}`
    )
      await region.getByRole("button", { name: "다음 그룹" }).click();
    await expect(region.getByRole("listitem")).toHaveCount(1);
    await expect(
      region.getByText("실제운동친구", { exact: true }),
    ).toBeVisible();
    await expect(region.getByRole("link")).toHaveAccessibleName(
      "함께하는 두 번째 그룹 그룹 보기",
    );
    await expect(region.getByRole("img")).toHaveCount(1);
    await expect(
      region.getByText("슬라이드그룹장", { exact: true }),
    ).toHaveCount(0);
    await other.goto(`${origin}/`);
    const peerRegion = other.getByRole("region", { name: "내 그룹의 햄스터" });
    await expect(peerRegion.getByRole("listitem")).toHaveCount(1);
    await expect(
      peerRegion.getByText("슬라이드그룹장", { exact: true }),
    ).toBeVisible();
    await expect(
      peerRegion.getByText("실제운동친구", { exact: true }),
    ).toHaveCount(0);
    for (const image of await region.getByRole("img").all()) {
      await expect(image).toHaveAttribute("data-pose", "basic");
      await expect(image).toHaveAttribute("data-wear", "none");
    }
    await region.getByRole("link").evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((animation) => animation.finished),
      );
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("home-groups-live.png"),
      fullPage: true,
    });
    await region.getByRole("button", { name: "다음 그룹" }).click();
    await expect(region.getByText("아직 다른 그룹원이 없어요.")).toBeVisible();
    await expect(region.getByRole("img")).toHaveCount(0);
    await expect(region.getByRole("link")).toHaveAttribute(
      "href",
      `/groups/${ids[0]}`,
    );
    await region.getByRole("button", { name: "이전 그룹" }).click();
    await expect(region.getByRole("listitem")).toHaveCount(1);
    const avatar = await (
      await other.request.get(`${api}/users/me/avatar/outfit`, {
        headers: member,
      })
    ).json();
    const changedAvatar = await other.request.put(
      `${api}/users/me/avatar/outfit`,
      {
        headers: { ...member, "If-Match": `"${avatar.revision}"` },
        data: {
          characterId: "character.gray",
          poseId: "pose.basic",
          clothingIds: [],
        },
      },
    );
    expect(changedAvatar.status()).toBe(200);
    expect(
      (
        await other.request.patch(`${api}/users/me/profile`, {
          headers: member,
          data: { nickname: "바뀐운동친구" },
        })
      ).status(),
    ).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      region.getByText("바뀐운동친구", { exact: true }),
    ).toBeVisible();
    await expect(region.getByRole("img")).toHaveAttribute(
      "data-variant",
      "gray",
    );
    await page.screenshot({
      path: info.outputPath("home-saved-avatar.png"),
      fullPage: true,
    });
    expect(
      (
        await other.request.delete(`${api}/groups/${ids[1]}/members/me`, {
          headers: member,
        })
      ).status(),
    ).toBe(204);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(region.getByText("아직 다른 그룹원이 없어요.")).toBeVisible();
    await expect(region.getByRole("img")).toHaveCount(0);
    expect(
      (
        await page.request.delete(`${api}/groups/${ids[1]}`, {
          headers: leader,
        })
      ).status(),
    ).toBe(204);
    ids.pop();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(region.getByRole("link")).toHaveAttribute(
      "href",
      `/groups/${ids[0]}`,
    );
    await expect(region.getByRole("button", { name: "다음 그룹" })).toHaveCount(
      0,
    );
  } finally {
    for (const id of ids)
      await respectRateLimit(() =>
        page.request.delete(`${api}/groups/${id}`, { headers: leader }),
      );
    for (const [client, headers] of [
      [page, leader],
      [other, member],
    ] as const)
      expect(
        (
          await respectRateLimit(() =>
            client.request.delete(`${api}/users/me`, {
              headers,
              data: { password },
            }),
          )
        ).status(),
      ).toBe(204);
    await context.close();
  }
});
