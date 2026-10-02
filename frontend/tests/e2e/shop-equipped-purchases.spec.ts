import { expect, test, type Page } from "@playwright/test";
import snapshot from "../../public/hamsters/wardrobe/catalog.json";
import type { ItemCatalog } from "../../components/hamster/types";
import type { Product } from "../../lib/shop-contract";
import {
  installCommerce,
  products as basics,
  rewardDate,
  rewardId,
} from "./avatar-rewards-fixtures";

const assets = snapshot.catalog as unknown as ItemCatalog;
const labels = { hat: "모자", top: "상의", bottom: "하의" };
const clothes: Product[] = Object.entries(assets).map(([renderKey, item]) => {
  if (item.slot === "accessory") throw new Error("Unsupported shop slot");
  return {
    id: `clothing.${renderKey}`,
    kind: "clothing",
    renderKey,
    slot: item.slot,
    occupiesSlots: [item.slot],
    ownershipScope: "shared",
    scopeCharacterId: null,
    saleStatus: "on_sale",
    price: { hat: 30, top: 25, bottom: 20 }[item.slot],
    priceProvisional: false,
    catalogRevision: 1,
  };
});
const firstSet = clothes.slice(0, 3);
const name = (p: Product) => assets[p.renderKey].label;
const panel = (page: Page) =>
  page.getByRole("region", { name: "현재 착용 아이템" });
const row = (page: Page, p: Product) =>
  panel(page).getByRole("listitem", { name: labels[p.slot!] });
const buyButton = (page: Page, p: Product) =>
  row(page, p).getByRole("button", { name: `${name(p)} 구매하기` });
async function toggle(page: Page, p: Product) {
  await page
    .getByRole("button", { name: labels[p.slot!], exact: true })
    .click();
  await page
    .locator(".shop-grid")
    .getByRole("button", { name: new RegExp(name(p)) })
    .click();
}
async function installSlots(page: Page) {
  const state = await installCommerce(page);
  const products = structuredClone(clothes);
  await page.unroute("**/hamsters/wardrobe/catalog.json");
  await page.unroute("**/hamsters/wardrobe/assets/*.png");
  const combinations = ["cream", "gray"].flatMap((variant) =>
    [0, 3].flatMap((start) =>
      Array.from({ length: 8 }, (_, mask) => ({
        characterId: `character.${variant}`,
        poseId: "pose.basic",
        clothingIds: clothes
          .slice(start, start + 3)
          .filter((_, bit) => mask & (1 << bit))
          .map((p) => p.id),
      })),
    ),
  );
  await page.route("**/api/v1/shop/products", (route) =>
    route.fulfill({
      json: {
        products: [
          ...basics.filter(
            (p) => p.kind === "character" || p.id === "pose.basic",
          ),
          ...products,
        ],
        combinations,
      },
    }),
  );
  await page.route("**/api/v1/shop/purchases", async (route) => {
    const req = route.request();
    const body = req.postDataJSON();
    state.purchases.push({
      key: req.headers()["idempotency-key"],
      body: req.postData()!,
    });
    const p = products.find((p) => p.id === body.productId)!;
    const replayed = state.owned.includes(p.id);
    if (!replayed) {
      state.owned.push(p.id);
      state.balance -= p.price!;
    }
    if (state.losePurchase) {
      state.losePurchase = false;
      return route.abort();
    }
    return route.fulfill({
      status: replayed ? 200 : 201,
      json: {
        currency: { balance: state.balance },
        inventory: state.owned.map((productId) => ({
          productId,
          source: "purchase",
          acquiredAt: rewardDate,
        })),
        replayed,
        purchase: {
          id: rewardId(90),
          productId: p.id,
          price: p.price,
          catalogRevision: body.catalogRevision,
          createdAt: rewardDate,
        },
      },
    });
  });
  return { state, products };
}

for (const width of [320, 1280]) {
  test(`${width}px 부위별 구매 목록은 on/off·교체·탭 이동·초기화와 일치한다`, async ({
    page,
  }, info) => {
    const { state } = await installSlots(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/shop");
    await expect(panel(page)).toHaveCount(0);
    for (const p of firstSet) await toggle(page, p);
    for (const p of firstSet) await expect(buyButton(page, p)).toBeEnabled();
    await expect(panel(page).getByRole("listitem")).toHaveCount(3);
    for (const p of firstSet) {
      await expect(buyButton(page, p)).toHaveCSS("color", "rgb(255, 255, 255)");
      expect((await row(page, p).boundingBox())!.height).toBeLessThanOrEqual(
        66,
      );
    }
    const preview = page.getByRole("img", { name: "내 캐릭터 미리보기" });
    await expect(preview.locator("image")).toHaveCount(4);
    await page.getByRole("button", { name: "자세", exact: true }).click();
    for (const p of firstSet) await expect(buyButton(page, p)).toBeEnabled();
    await page.screenshot({
      path: info.outputPath(`equipped-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const hat = firstSet.find((p) => p.slot === "hat")!;
    await toggle(page, hat);
    await expect(row(page, hat)).toHaveCount(0);
    await expect(row(page, hat).getByRole("button")).toHaveCount(0);
    await expect(preview.locator("image")).toHaveCount(3);
    const otherHat = clothes.find((p) => p.slot === "hat" && p.id !== hat.id)!;
    await toggle(page, otherHat);
    await expect(row(page, otherHat)).toContainText(name(otherHat));
    await expect(panel(page).getByText(name(hat), { exact: true })).toHaveCount(
      0,
    );
    await toggle(page, hat);
    await expect(row(page, hat)).toContainText(name(hat));
    await expect(
      panel(page).getByText(name(otherHat), { exact: true }),
    ).toHaveCount(0);
    // Buy the hat while the last clicked card is the bottom.
    await toggle(
      page,
      firstSet.find((p) => p.slot === "bottom")!,
    );
    await toggle(
      page,
      firstSet.find((p) => p.slot === "bottom")!,
    );
    await buyButton(page, hat).click();
    const dialog = page.getByRole("dialog", { name: "구매할까요?" });
    await expect(dialog).toContainText(name(hat));
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(state.purchases).toEqual([]);
    await buyButton(page, hat).click();
    await dialog
      .getByRole("button", { name: "구매 확정", exact: true })
      .click();
    await expect(row(page, hat)).toHaveCount(0);
    expect(JSON.parse(state.purchases[0].body)).toEqual({
      productId: hat.id,
      catalogRevision: hat.catalogRevision,
    });
    expect(state.purchases).toHaveLength(1);
    expect(state.puts).toBe(0);
    await expect(preview.locator("image")).toHaveCount(4);
    await page.getByRole("button", { name: "초기화", exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(panel(page).getByRole("button")).toHaveCount(0);
  });
}

test("보유·판매 불가·가격 미확정·잔액 부족은 부위별로 구매를 막는다", async ({
  page,
}) => {
  const { state, products } = await installSlots(page);
  state.balance = 0;
  const hat = products.find((p) => p.slot === "hat")!;
  const top = products.find((p) => p.slot === "top")!;
  const bottom = products.find((p) => p.slot === "bottom")!;
  hat.saleStatus = "held";
  top.priceProvisional = true;
  await page.goto("/shop");
  for (const p of [hat, top, bottom]) await toggle(page, p);
  await expect(buyButton(page, hat)).toHaveText("판매하지 않는 아이템");
  await expect(buyButton(page, top)).toHaveText("가격 확정 전");
  await expect(buyButton(page, bottom)).toHaveText("해바라기씨 부족");
  for (const p of [hat, top, bottom])
    await expect(buyButton(page, p)).toBeDisabled();
  state.owned.push(...firstSet.map((p) => p.id));
  state.outfit.clothingIds = firstSet.map((p) => p.id);
  state.outfit.rendering.clothing = firstSet.map((p) => ({
    productId: p.id,
    slot: p.slot!,
    renderKey: p.renderKey,
    occupiesSlots: p.occupiesSlots,
  }));
  await page.reload();
  for (const p of firstSet) await expect(row(page, p)).toHaveCount(0);
  await expect(panel(page).getByRole("button")).toHaveCount(0);
  expect(state.purchases).toEqual([]);
  expect(state.puts).toBe(0);
});

test("구매 후 재조회 실패에도 응답의 보유·잔액을 즉시 반영하고 다음 부위를 구매한다", async ({
  page,
}) => {
  const { state } = await installSlots(page);
  state.balance = 55;
  await page.route("**/api/v1/users/me/avatar/inventory", (route) => {
    if (state.purchases.length)
      return route.fulfill({ status: 503, json: { message: "재조회 실패" } });
    return route.fallback();
  });
  await page.goto("/shop");
  for (const p of firstSet) await toggle(page, p);
  const hat = firstSet.find((p) => p.slot === "hat")!;
  const top = firstSet.find((p) => p.slot === "top")!;
  const bottom = firstSet.find((p) => p.slot === "bottom")!;
  await buyButton(page, hat).click();
  // Dispatch two clicks in one task to exercise the synchronous write guard.
  await page
    .getByRole("button", { name: "구매 확정", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(row(page, hat)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "다시 불러오기" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "보유 재화" })).toHaveText("25");
  expect(state.purchases).toHaveLength(1);
  await expect(buyButton(page, top)).toBeEnabled();
  await buyButton(page, top).click();
  await page.getByRole("button", { name: "구매 확정", exact: true }).click();
  await expect(row(page, top)).toHaveCount(0);
  await expect(page.getByRole("group", { name: "보유 재화" })).toHaveText("0");
  await expect(buyButton(page, bottom)).toBeDisabled();
  await expect(buyButton(page, bottom)).toHaveText("해바라기씨 부족");
  expect(state.purchases.map((p) => JSON.parse(p.body).productId)).toEqual([
    hat.id,
    top.id,
  ]);
  expect(new Set(state.purchases.map((p) => p.key)).size).toBe(2);
  expect(state.puts).toBe(0);
  await expect(
    page.getByRole("img", { name: "내 캐릭터 미리보기" }).locator("image"),
  ).toHaveCount(4);
});

test("부위별 구매 응답 유실은 원래 요청으로 복구하고 다음 상품에는 새 키를 사용한다", async ({
  page,
}) => {
  const { state } = await installSlots(page);
  state.losePurchase = true;
  await page.goto("/shop");
  for (const p of firstSet) await toggle(page, p);
  const hat = firstSet.find((p) => p.slot === "hat")!;
  const top = firstSet.find((p) => p.slot === "top")!;
  await buyButton(page, hat).click();
  await page.getByRole("button", { name: "구매 확정", exact: true }).click();
  const retry = page.getByRole("button", { name: "이전 구매 결과 확인" });
  await expect(retry).toBeVisible();
  await expect(buyButton(page, top)).toBeDisabled();
  expect(state.balance).toBe(70);
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(row(page, hat)).toHaveCount(0);
  await expect(buyButton(page, top)).toBeEnabled();
  expect(state.purchases).toHaveLength(2);
  expect(state.purchases[0]).toEqual(state.purchases[1]);
  await buyButton(page, top).click();
  await page.getByRole("button", { name: "구매 확정", exact: true }).click();
  await expect(row(page, top)).toHaveCount(0);
  expect(state.purchases).toHaveLength(3);
  expect(state.purchases[2].key).not.toBe(state.purchases[0].key);
  expect(JSON.parse(state.purchases[2].body).productId).toBe(top.id);
  expect(state.balance).toBe(45);
  expect(state.puts).toBe(0);
  await expect(
    page.getByRole("img", { name: "내 캐릭터 미리보기" }).locator("image"),
  ).toHaveCount(4);
});

for (const code of [
  "CATALOG_CHANGED",
  "ALREADY_OWNED",
  "INSUFFICIENT_FUNDS",
] as const) {
  test(`${code} 거절 시 구매 상태를 새로 조회하고 미리보기를 유지한다`, async ({
    page,
  }) => {
    const { state, products } = await installSlots(page);
    const hat = products.find((p) => p.slot === "hat")!;
    let rejectedKey = "";
    await page.route(
      "**/api/v1/shop/purchases",
      async (route) => {
        rejectedKey = route.request().headers()["idempotency-key"];
        if (code === "CATALOG_CHANGED") {
          hat.price = 35;
          hat.catalogRevision++;
        }
        if (code === "ALREADY_OWNED") state.owned.push(hat.id);
        if (code === "INSUFFICIENT_FUNDS") state.balance = 0;
        await route.fulfill({ status: 409, json: { code } });
      },
      { times: 1 },
    );
    await page.goto("/shop");
    for (const p of firstSet) await toggle(page, p);
    await buyButton(page, hat).click();
    await page.getByRole("button", { name: "구매 확정", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "이전 구매 결과 확인" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: "내 캐릭터 미리보기" }).locator("image"),
    ).toHaveCount(4);
    if (code === "ALREADY_OWNED") await expect(row(page, hat)).toHaveCount(0);
    if (code === "INSUFFICIENT_FUNDS")
      await expect(buyButton(page, hat)).toBeDisabled();
    if (code === "CATALOG_CHANGED") {
      await expect(buyButton(page, hat)).toHaveText("구매하기 · 35개");
      await buyButton(page, hat).click();
      await page
        .getByRole("button", { name: "구매 확정", exact: true })
        .click();
      await expect(row(page, hat)).toHaveCount(0);
      expect(state.purchases[0].key).not.toBe(rejectedKey);
      expect(JSON.parse(state.purchases[0].body)).toEqual({
        productId: hat.id,
        catalogRevision: 2,
      });
    }
    expect(state.puts).toBe(0);
  });
}

test("확인창이 열린 동안 가격이 갱신되면 이전 가격으로 구매하지 않는다", async ({
  page,
}) => {
  const { state, products } = await installSlots(page);
  const hat = products.find((p) => p.slot === "hat")!;
  await page.clock.install();
  await page.goto("/shop");
  await toggle(page, hat);
  await buyButton(page, hat).click();
  hat.price = 35;
  hat.catalogRevision = 2;
  await page.clock.fastForward(300001);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const dialog = page.getByRole("dialog", { name: "구매할까요?" });
  await expect(dialog).toContainText("상품이나 보유 정보가 변경되었어요.");
  await expect(
    dialog.getByRole("button", { name: "구매 확정", exact: true }),
  ).toBeDisabled();
  expect(state.purchases).toEqual([]);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(buyButton(page, hat)).toHaveText("구매하기 · 35개");
  await buyButton(page, hat).click();
  await dialog.getByRole("button", { name: "구매 확정", exact: true }).click();
  await expect(row(page, hat)).toHaveCount(0);
  expect(JSON.parse(state.purchases[0].body)).toEqual({
    productId: hat.id,
    catalogRevision: 2,
  });
  expect(state.balance).toBe(65);
});
