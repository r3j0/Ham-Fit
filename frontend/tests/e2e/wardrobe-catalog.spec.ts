import { expect, test } from "@playwright/test";
import snapshot from "../../public/hamsters/wardrobe/catalog.json";
import type { ItemCatalog } from "../../components/hamster/types";
import type { Product } from "../../lib/shop-contract";
import {
  installCommerce,
  products as fixtureProducts,
} from "./avatar-rewards-fixtures";

const assets = snapshot.catalog as unknown as ItemCatalog;
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

test("배포된 두 의상 세트의 가격과 실제 정적 PNG를 표시하고 같은 세트를 함께 미리본다", async ({
  page,
}, info) => {
  await installCommerce(page);
  await page.unroute("**/hamsters/wardrobe/catalog.json");
  await page.unroute("**/hamsters/wardrobe/assets/*.png");
  const basics = fixtureProducts.filter(
    (p) => p.kind === "character" || p.id === "pose.basic",
  );
  const combinations = ["cream", "gray"].flatMap((variant) => [
    {
      characterId: `character.${variant}`,
      poseId: "pose.basic",
      clothingIds: [] as string[],
    },
    ...[0, 3].flatMap((start) =>
      Array.from({ length: 7 }, (_, index) => ({
        characterId: `character.${variant}`,
        poseId: "pose.basic",
        clothingIds: clothes
          .slice(start, start + 3)
          .filter((_, bit) => (index + 1) & (1 << bit))
          .map((p) => p.id),
      })),
    ),
  ]);
  await page.route("**/api/v1/shop/products", (route) =>
    route.fulfill({
      json: { products: [...basics, ...clothes], combinations },
    }),
  );
  const backendImages: string[] = [];
  page.on("request", (req) => {
    if (
      /\/api\/v\d+\/(?:avatar\/(?:assets|render-catalog)|avatar-manager\/)/.test(
        req.url(),
      )
    )
      backendImages.push(req.url());
  });
  await page.goto("/shop");
  const preview = page.getByRole("img", { name: "내 캐릭터 미리보기" });
  for (const start of [0, 3]) {
    if (start)
      await page.getByRole("button", { name: "초기화", exact: true }).click();
    for (const product of clothes.slice(start, start + 3)) {
      await page
        .getByRole("button", {
          name: { hat: "모자", top: "상의", bottom: "하의" }[product.slot!],
          exact: true,
        })
        .click();
      const card = page.getByRole("button", {
        name: new RegExp(
          `${assets[product.renderKey].label}.*${product.price}개`,
        ),
      });
      await expect(card).toBeVisible();
      await card.click();
      await expect(
        preview.locator(
          `image[href="${assets[product.renderKey].poses.basic!.cream!.layers[0].src}"]`,
        ),
      ).toHaveCount(1);
    }
    await expect(preview.locator("image")).toHaveCount(4);
    await expect(preview).not.toHaveAttribute("data-hamster-warnings");
    await page.screenshot({
      path: info.outputPath(`set-${start / 3 + 1}-shop.png`),
      fullPage: true,
    });
  }
  const failed = await page.locator("svg image").evaluateAll(async (nodes) => {
    const urls = [
      ...new Set(
        nodes.map((node) => node.getAttribute("href")!).filter(Boolean),
      ),
    ];
    return (
      await Promise.all(
        urls.map(
          (url) =>
            new Promise<string | null>((resolve) => {
              const image = new Image();
              image.onload = () => resolve(null);
              image.onerror = () => resolve(url);
              image.src = url;
            }),
        ),
      )
    ).filter(Boolean);
  });
  expect(failed).toEqual([]);
  expect(backendImages).toEqual([]);
});
