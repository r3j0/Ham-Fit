import { expect, test, type Page } from "@playwright/test";
import {
  installCommerce,
  rewardId as id,
  rewardDate as date,
} from "./avatar-rewards-fixtures";
import { testUser } from "./integration-fixtures";

async function setup(page: Page, kind: "personal" | "group", count = 2) {
  const commerce = await installCommerce(page);
  const state = {
    used: new Set<string>(),
    writes: [] as { body: string; key: string }[],
    failTickets: false,
    failSpin: false,
    reward: "seeds" as "seeds" | "clothing" | "pose",
  };
  const path =
    kind === "personal"
      ? "/users/me/streak-roulette"
      : `/groups/${id(1)}/roulette`;
  const url =
    kind === "personal" ? "/roulette/personal" : `/groups/${id(1)}/roulette`;
  const tickets = Array.from({ length: count }, (_, index) => ({
    id: id(10 + index),
    createdAt: date,
    policyVersion:
      kind === "personal" ? "streak-2026-10-01-v1" : "sunflower-2026-09-30-v1",
    ...(kind === "personal"
      ? {
          achievementId: id(20 + index),
          koreanDate: `2026-10-${index ? "10" : "05"}`,
          segmentStartDate: "2026-10-01",
          streakDays: (index + 1) * 5,
        }
      : { roundId: id(2), invalidatedAt: null }),
  }));
  await page.route(`**/api/v1${path}/**`, async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith("/tickets")) {
      if (state.failTickets) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({
        json: {
          items: tickets.map((t) => ({
            ...t,
            status: state.used.has(t.id) ? "used" : "available",
            usable: !state.used.has(t.id),
            usedAt: state.used.has(t.id) ? date : null,
          })),
          availableCount: count - state.used.size,
          nextCursor: null,
        },
      });
    }
    if (new URL(request.url()).pathname.endsWith("/draws"))
      return route.fulfill({ json: { items: [], nextCursor: null } });
    state.writes.push({
      body: request.postData()!,
      key: request.headers()["idempotency-key"],
    });
    if (state.failSpin) return route.fulfill({ status: 503, json: {} });
    const ticketId = request.postDataJSON().ticketId;
    expect(state.used.has(ticketId)).toBe(false);
    state.used.add(ticketId);
    if (state.reward !== "seeds")
      commerce.owned.push(
        state.reward === "pose" ? "pose.run" : "clothing.mint-shirt",
      );
    else commerce.balance += 3;
    const ticketIndex = tickets.findIndex((t) => t.id === ticketId);
    const selected = tickets[ticketIndex];
    const draw =
      kind === "personal"
        ? {
            id: id(30),
            ticketId,
            drawnAt: date,
            policyVersion: selected.policyVersion,
            originalResult: state.reward === "seeds" ? "seeds_3" : state.reward,
            actualReward:
              state.reward === "seeds"
                ? {
                    kind: "seeds",
                    amount: 3,
                    productId: null,
                    transactionId: id(31),
                  }
                : {
                    kind: state.reward,
                    amount: 1,
                    productId:
                      state.reward === "pose"
                        ? "pose.run"
                        : "clothing.mint-shirt",
                    transactionId: null,
                  },
            fallback: { applied: false, reason: null },
            achievement: {
              id: id(20 + ticketIndex),
              koreanDate: `2026-10-${ticketIndex ? "10" : "05"}`,
              segmentStartDate: "2026-10-01",
              streakDays: (ticketIndex + 1) * 5,
              achievedAt: date,
              sourceKind: "routine",
              sourceId: id(40),
            },
          }
        : {
            id: id(30),
            ticketId,
            roundId: id(2),
            drawnAt: date,
            policyVersion: selected.policyVersion,
            result: "contributors_3",
            amountPerRecipient: 3,
            recipients: [{ userId: testUser.id, amount: 3 }],
            myReward: [{ amount: 3, transactionId: id(31) }],
          };
    return route.fulfill({ status: 201, json: { draw, replayed: false } });
  });
  return { state, url };
}

for (const kind of ["personal", "group"] as const) {
  test(`${kind}: 아이콘 항목, 테마와 작은 화면을 확인하고 빠른 회전→감속→보상을 표시한다`, async ({
    page,
  }, info) => {
    const { state, url } = await setup(page, kind);
    await page.goto(url);
    const wheel = page.getByRole("img", { name: /^룰렛:/ });
    await expect(wheel).toBeVisible();
    const rotor = wheel.locator("div").first();
    expect(
      (await rotor.locator(":scope > span").allTextContents()).sort(),
    ).toEqual(
      kind === "personal"
        ? ["1", "3", "5", "10", "", ""].sort()
        : ["1", "3", "5", "7", "3", "7"].sort(),
    );
    expect(
      await page
        .locator("main")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--roulette-tone").trim(),
        ),
    ).toBe(kind === "personal" ? "#0a2a70" : "#ff7f00");
    for (const width of [320, 390, 800, 1218]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`${kind}-${width}.png`),
        fullPage: true,
      });
    }
    const labels = await rotor
      .locator(":scope > span")
      .evaluateAll((sectors) =>
        sectors.map((sector) => sector.getAttribute("data-prize")),
      );
    const winningIndex = labels.indexOf(
      kind === "personal" ? "해바라기씨 3개" : "기여자마다 3개",
    );
    if (kind === "group") {
      const legend = page.getByRole("region", { name: "그룹 룰렛 보상 확률" });
      await expect(legend).toBeVisible();
      expect(await legend.locator("li").allTextContents()).toEqual([
        "1나에게 1개50%",
        "3나에게 3개25%",
        "5나에게 5개13%",
        "7나에게 7개7%",
        "3기여자마다 3개4%",
        "7기여자마다 7개1%",
      ]);
      const bounds = await legend.boundingBox(),
        wheelBounds = await wheel.boundingBox();
      expect(bounds!.x).toBeGreaterThan(wheelBounds!.x + wheelBounds!.width);
      expect(bounds!.y + bounds!.height).toBeCloseTo(
        wheelBounds!.y + wheelBounds!.height,
        0,
      );
      await expect(page.locator("details")).toHaveCount(0);
    }
    await page.evaluate(() => {
      Math.random = () => 0.02;
    });
    const spin = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
    await spin.click();
    await expect(wheel).toHaveAttribute("data-phase", "spinning");
    expect(
      await rotor.evaluate(
        (el) => el.getAnimations()[0].effect?.getTiming().duration,
      ),
    ).toBe(90);
    expect(await rotor.evaluate((el) => getComputedStyle(el).filter)).toBe(
      "blur(4px)",
    );
    await expect(wheel).toHaveAttribute("data-phase", "settling");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await rotor.evaluate(
        (el) => el.getAnimations()[0].effect?.getTiming().easing,
      ),
    ).toBe("cubic-bezier(0.1, 0.65, 0.13, 1)");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "해바라기씨 3개를 받았어요!" }),
    ).toBeVisible();
    const landing = () =>
      rotor.evaluate((el) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return (
          ((((-Math.atan2(matrix.b, matrix.a) * 180) / Math.PI) % 360) + 360) %
          360
        );
      });
    const firstLanding = await landing();
    expect(Math.floor(firstLanding / 60)).toBe(winningIndex);
    expect(firstLanding % 60).toBeCloseTo(6.96, 2);
    await page.screenshot({
      path: info.outputPath(`${kind}-reward.png`),
      fullPage: true,
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(url);
    await expect(
      page.getByRole("button", { name: "룰렛 돌리기", exact: true }),
    ).toBeEnabled();
    expect(state.writes).toHaveLength(1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      Math.random = () => 0.98;
    });
    await page
      .getByRole("button", { name: "룰렛 돌리기", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const secondLanding = await landing();
    expect(Math.floor(secondLanding / 60)).toBe(winningIndex);
    expect(secondLanding % 60).toBeCloseTo(53.04, 2);
    expect(secondLanding).not.toBeCloseTo(firstLanding, 0);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "확인", exact: true })
      .click();
    await expect(page).toHaveURL("/");
    expect(state.writes).toHaveLength(2);
    expect(state.writes[0].key).not.toBe(state.writes[1].key);
  });
  test(`${kind}: 다시 열면 항목이 섞이고 API 재조회 중에는 배치를 유지한다`, async ({
    page,
  }) => {
    const { url } = await setup(page, kind);
    const order = () =>
      page
        .getByRole("img", { name: /^룰렛:/ })
        .locator("div > span")
        .evaluateAll((sectors) =>
          sectors.map((sector) => sector.getAttribute("data-prize")),
        );
    const ready = () =>
      expect(
        page.getByRole("button", { name: "룰렛 돌리기", exact: true }),
      ).toBeEnabled();
    await page.goto(url);
    await ready();
    const first = await order();
    await page.reload();
    await ready();
    const second = await order();
    expect(second).not.toEqual(first);
    expect([...second].sort()).toEqual([...first].sort());
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await ready();
    expect(await order()).toEqual(second);
    // Even identical random draws on re-entry must not repeat the previous order.
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });
    await page.reload();
    await ready();
    const third = await order();
    await page.reload();
    await ready();
    expect(await order()).not.toEqual(third);
  });
  test(`${kind}: 마지막 권의 팝업이 자동으로 닫히면 메인으로 이동한다`, async ({
    page,
  }) => {
    const { url } = await setup(page, kind, 1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url);
    await page
      .getByRole("button", { name: "룰렛 돌리기", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(url);
    await expect(page).toHaveURL("/");
  });
}

test("추첨 실패는 보상 팝업이나 자동 이동 없이 같은 키로 재시도한다", async ({
  page,
}) => {
  const { state, url } = await setup(page, "personal", 1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  state.failSpin = true;
  await page.goto(url);
  await page.getByRole("button", { name: "룰렛 돌리기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이전 추첨 결과 확인" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /^룰렛:/ })).toHaveAttribute(
    "data-phase",
    "idle",
  );
  state.failSpin = false;
  await page.getByRole("button", { name: "이전 추첨 결과 확인" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(state.writes[0]).toEqual(state.writes[1]);
});

test("남은 권 조회 실패를 0회로 판단하지 않고 재조회 성공 후 이동한다", async ({
  page,
}) => {
  const { state, url } = await setup(page, "group", 1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "룰렛 돌리기", exact: true }),
  ).toBeEnabled();
  state.failTickets = true;
  await page.getByRole("button", { name: "룰렛 돌리기", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "확인", exact: true })
    .click();
  await expect(page.locator(".notice[role=alert]")).toBeVisible();
  await expect(page).toHaveURL(url);
  state.failTickets = false;
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page).toHaveURL("/");
});

for (const kind of ["clothing", "pose"] as const)
  test(`${kind} 보상은 아이콘과 상품명을 팝업에 표시한다`, async ({ page }) => {
    const { state, url } = await setup(page, "personal", 1);
    state.reward = kind;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url);
    await page
      .getByRole("button", { name: "룰렛 돌리기", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name:
          kind === "clothing"
            ? "민트 티셔츠를 받았어요!"
            : "달리기를 받았어요!",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("받은 아이템은 내 옷장에서 확인할 수 있어요."),
    ).toBeVisible();
  });
