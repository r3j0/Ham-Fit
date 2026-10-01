import { expect, test, type Page } from "@playwright/test";
import {
  installCommerce,
  rewardId as id,
  rewardDate as date,
} from "./avatar-rewards-fixtures";
import { testUser } from "./integration-fixtures";

const group = (n: number) => ({
  id: id(n),
  name: `함께 운동 ${n}`,
  description: "",
  maxMembers: 5,
  currentMembers: 3,
  role: "leader",
  createdAt: date,
});
const ticket = (n: number, used = false) => ({
  id: id(n),
  roundId: id(20),
  createdAt: date,
  policyVersion: "sunflower-2026-09-30-v1",
  status: used ? "used" : "available",
  usable: !used,
  usedAt: used ? date : null,
  invalidatedAt: null,
});
const milestone = {
  id: id(33),
  koreanDate: "2026-10-05",
  segmentStartDate: "2026-10-01",
  streakDays: 5,
  achievedAt: "2026-10-05T00:00:00Z",
  sourceKind: "routine",
  sourceId: id(34),
};
const personalTicket = (used = false) => ({
  id: id(31),
  achievementId: id(33),
  koreanDate: milestone.koreanDate,
  segmentStartDate: milestone.segmentStartDate,
  streakDays: 5,
  createdAt: milestone.achievedAt,
  policyVersion: "streak-2026-10-01-v1",
  status: used ? "used" : "available",
  usable: !used,
  usedAt: used ? milestone.achievedAt : null,
});
async function setup(page: Page) {
  const commerce = await installCommerce(page);
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/v1/users/me/streak-roulette/tickets?*", (route) =>
    route.fulfill({ json: { items: [], availableCount: 0, nextCursor: null } }),
  );
  return commerce;
}

test("알림에 개인 전체 횟수와 여러 그룹의 페이지 병합 횟수를 모으고 모바일에서도 표시한다", async ({
  page,
}, info) => {
  await setup(page);
  await page.route("**/api/v1/groups?*", (route) =>
    route.fulfill({ json: { items: [group(1), group(2)], nextCursor: null } }),
  );
  await page.route(`**/api/v1/groups/${id(1)}/roulette/tickets?*`, (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has("cursor")
        ? { items: [ticket(11), ticket(12)], nextCursor: null }
        : { items: [ticket(10, true), ticket(11)], nextCursor: id(11) },
    }),
  );
  await page.route(`**/api/v1/groups/${id(2)}/roulette/tickets?*`, (route) =>
    route.fulfill({ json: { items: [ticket(13)], nextCursor: null } }),
  );
  await page.route("**/api/v1/users/me/streak-roulette/tickets?*", (route) =>
    route.fulfill({
      json: {
        items: [personalTicket(true)],
        availableCount: 7,
        nextCursor: null,
      },
    }),
  );
  await page.goto("/account/notifications");
  await expect(page.getByLabel("그룹 룰렛 사용 가능 횟수")).toHaveText("3회");
  const groups = page.getByRole("region", { name: "그룹 룰렛", exact: true });
  await expect(groups.getByRole("link", { name: "룰렛 돌리기" })).toHaveCount(
    2,
  );
  if (process.env.E2E_PERSONAL_ROULETTE === "true")
    await expect(page.getByLabel("개인 룰렛 사용 가능 횟수")).toHaveText("7회");
  else
    await expect(page.getByLabel("개인 룰렛 사용 가능 횟수")).toHaveText(
      "준비 중",
    );
  for (const width of [320, 390, 1218]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`roulette-notifications-${width}.png`),
      fullPage: true,
    });
  }
  await groups.getByRole("link", { name: "룰렛 돌리기" }).first().click();
  await expect(page).toHaveURL(`/groups/${id(1)}/roulette`);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /개인 룰렛|함께 운동 .*룰렛/ }),
  ).toHaveCount(0);
});

test("0회는 비활성화하고 조회 실패를 0회로 표시하지 않으며 다른 그룹은 계속 사용할 수 있다", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/v1/groups?*", (route) =>
    route.fulfill({ json: { items: [group(1), group(2)], nextCursor: null } }),
  );
  let fail = false;
  await page.route(`**/api/v1/groups/${id(1)}/roulette/tickets?*`, (route) =>
    fail
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(`**/api/v1/groups/${id(2)}/roulette/tickets?*`, (route) =>
    route.fulfill({ json: { items: [ticket(13)], nextCursor: null } }),
  );
  await page.goto("/account/notifications");
  const groups = page.getByRole("region", { name: "그룹 룰렛", exact: true });
  await expect(
    groups.getByRole("button", { name: "룰렛 돌리기" }),
  ).toBeDisabled();
  fail = true;
  await page.getByRole("button", { name: "알림 새로고침" }).click();
  await expect(page.getByLabel("그룹 룰렛 사용 가능 횟수")).toHaveText(
    "확인 필요",
  );
  await expect(groups.getByRole("link", { name: "룰렛 돌리기" })).toHaveCount(
    1,
  );
  fail = false;
  await groups
    .getByRole("button", { name: "그룹 룰렛 횟수 다시 확인" })
    .click();
  await expect(page.getByLabel("그룹 룰렛 사용 가능 횟수")).toHaveText("1회");
});

for (const result of ["seeds", "pose", "fallback"] as const) {
  test(`개인 룰렛 실제 계약: ${result} 지급과 응답 유실·알림 복귀 복구`, async ({
    page,
  }) => {
    test.skip(
      process.env.E2E_PERSONAL_ROULETTE !== "true",
      "개인 룰렛을 활성화한 서버에서 실행",
    );
    const commerce = await setup(page);
    let used = false,
      lose = true;
    const writes: { key: string; body: string }[] = [];
    await page.route("**/api/v1/users/me/streak-roulette/**", (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path.endsWith("/tickets"))
        return route.fulfill({
          json: {
            items: [personalTicket(used)],
            availableCount: used ? 0 : 1,
            nextCursor: null,
          },
        });
      expect(path.endsWith("/spins")).toBe(true);
      expect(req.method()).toBe("POST");
      expect(req.headers()["x-csrf-protection"]).toBe("1");
      writes.push({
        key: req.headers()["idempotency-key"],
        body: req.postData()!,
      });
      if (!used) {
        if (result === "pose") commerce.owned.push("pose.run");
        else commerce.balance += result === "fallback" ? 50 : 1;
      }
      used = true;
      if (lose) {
        lose = false;
        return route.abort();
      }
      return route.fulfill({
        status: 200,
        json: {
          replayed: true,
          draw: {
            id: id(32),
            ticketId: id(31),
            drawnAt: "2026-10-05T01:00:00Z",
            achievement: milestone,
            policyVersion: "streak-2026-10-01-v1",
            originalResult:
              result === "pose"
                ? "pose"
                : result === "fallback"
                  ? "clothing"
                  : "seeds_1",
            actualReward:
              result === "pose"
                ? {
                    kind: "pose",
                    amount: 1,
                    productId: "pose.run",
                    transactionId: null,
                  }
                : {
                    kind: "seeds",
                    amount: result === "fallback" ? 50 : 1,
                    productId: null,
                    transactionId: id(35),
                  },
            fallback: {
              applied: result === "fallback",
              reason: result === "fallback" ? "no_eligible_product" : null,
            },
          },
        },
      });
    });
    await page.goto("/account/notifications");
    await page
      .getByRole("region", { name: "개인 룰렛", exact: true })
      .getByRole("link", { name: "룰렛 돌리기" })
      .click();
    await page.getByText("이번 룰렛의 보상 확률").click();
    await expect(
      page.getByText("랜덤 자세 · 0.1%", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "룰렛 돌리기", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "이전 추첨 결과 확인" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "알림으로", exact: true }).click();
    await expect(page.getByLabel("개인 룰렛 사용 가능 횟수")).toHaveText("0회");
    await page.reload();
    await page.getByRole("link", { name: "이전 추첨 결과 확인" }).click();
    await page.getByRole("button", { name: "이전 추첨 결과 확인" }).click();
    if (result === "pose")
      await expect(
        page.getByText("받은 아이템은 내 옷장에서 확인할 수 있어요."),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("heading", {
          name: `해바라기씨 ${result === "fallback" ? 50 : 1}개를 받았어요!`,
        }),
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "룰렛 돌리기", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(`보유 해바라기씨 ${commerce.balance}개`),
    ).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
    expect(JSON.parse(writes[0].body)).toEqual({ ticketId: id(31) });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "확인", exact: true })
      .click();
    await expect(page).toHaveURL("/");
    await page.goto("/account/notifications");
    await expect(
      page
        .getByRole("region", { name: "개인 룰렛", exact: true })
        .getByRole("button", { name: "룰렛 돌리기" }),
    ).toBeDisabled();
  });
}

test("그룹 물 주기 배지는 현재 참여자만 표시하고 새 미션 값과 계약 오류를 반영한다", async ({
  page,
}, info) => {
  await setup(page);
  let roundId = id(20),
    count: number | string = 7;
  await page.route(`**/api/v1/groups/${id(1)}`, (route) =>
    route.fulfill({
      json: {
        ...group(1),
        members: [testUser.id, id(2), id(3)].map((userId, index) => ({
          userId,
          nickname: `그룹원${index}`,
          profileCharacter: null,
          role: index ? "member" : "leader",
          streak: 0,
          joinedAt: date,
          todayWorkoutCompleted: false,
          missionContribution:
            index === 2
              ? null
              : { roundId, waterCount: index === 0 ? count : 0 },
        })),
      },
    }),
  );
  await page.goto(`/groups/${id(1)}`);
  const members = page.getByRole("region", { name: "그룹원", exact: true });
  await expect(members.getByLabel("현재 미션 물 주기 7회")).toBeVisible();
  await expect(members.getByLabel("현재 미션 물 주기 0회")).toHaveCount(1);
  await expect(
    members.locator("[aria-label^='현재 미션 물 주기']"),
  ).toHaveCount(2);
  for (const width of [320, 390, 1218]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`member-water-${width}.png`),
      fullPage: true,
    });
  }
  roundId = id(21);
  count = 0;
  await page.reload();
  await expect(members.getByLabel("현재 미션 물 주기 0회")).toHaveCount(2);
  await expect(members.getByLabel("현재 미션 물 주기 7회")).toHaveCount(0);
  count = "invalid";
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버 응답을 확인할 수 없어요",
  );
  await expect(members).toHaveCount(0);
});
