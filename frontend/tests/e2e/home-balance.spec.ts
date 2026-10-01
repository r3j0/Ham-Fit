import { refreshOnFocus } from "./resource-refresh";
import { expect, test } from "@playwright/test";
import { installCommerce } from "./avatar-rewards-fixtures";
import { testUser } from "./integration-fixtures";

test("홈은 재화를 표시하지 않고 로고와 알림을 한 행에 배치하며 프로필은 잔액을 유지한다", async ({
  page,
}, info) => {
  await installCommerce(page);
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      json: {
        ...testUser,
        nickname: null,
        isOnboarded: true,
        currency: { balance: 2147483647 },
        currentCurriculum: null,
      },
    }),
  );
  await page.goto("/");
  const balance = page.getByRole("group", { name: "보유 재화" });
  await expect(balance).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /상점, 보유 해바라기씨/ }),
  ).toHaveCount(0);
  await expect(page.locator(".my-character .shop-balance")).toHaveCount(0);
  for (const width of [320, 600, 1280]) {
    await page.setViewportSize({ width, height: 786 });
    const bell = (await page
      .getByRole("link", { name: "알림", exact: true })
      .boundingBox())!;
    const brand = (await page.locator(".home-toolbar > .brand").boundingBox())!;
    expect(brand.y + brand.height / 2).toBeCloseTo(bell.y + bell.height / 2, 1);
    expect(brand.x + brand.width).toBeLessThanOrEqual(bell.x);
    expect(bell.x + bell.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`home-toolbar-${width}.png`),
    });
  }
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(balance).toHaveText("2,147,483,647");
  await expect(balance.getByRole("img")).toHaveAttribute(
    "src",
    "/icons/sunflower-seed.svg",
  );
});

test("상점 구매 뒤 홈에 재화를 표시하지 않고 프로필 잔액은 갱신된다", async ({
  page,
}) => {
  const state = await installCommerce(page);
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      json: {
        ...testUser,
        nickname: null,
        isOnboarded: true,
        currency: { balance: state.balance },
        currentCurriculum: null,
      },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "상점", exact: true })
    .click();
  await page.getByRole("button", { name: "자세", exact: true }).click();
  await page.getByRole("button", { name: /궁금.*50개/ }).click();
  await page.getByRole("button", { name: /궁금 구매하기/ }).click();
  await page.getByRole("button", { name: "구매 확정", exact: true }).click();
  await expect(
    page.getByText("구매했어요. 내 옷장에서 착용하고 저장할 수 있어요."),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await expect(page.getByRole("group", { name: "보유 재화" })).toHaveCount(0);
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(page.getByRole("group", { name: "보유 재화" })).toHaveText("50");
});

test("재화 조회 오류를 0개로 표시하지 않고 캐릭터는 보유 목록 장애와 독립적으로 표시한다", async ({
  page,
}) => {
  await installCommerce(page);
  await page.route("**/users/me/avatar/inventory", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "나의 대표 캐릭터" }),
  ).toBeVisible();
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await refreshOnFocus(page);
  await expect(
    page.getByRole("button", { name: "다시 불러오기", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "보유 재화" })).toHaveCount(0);
});
