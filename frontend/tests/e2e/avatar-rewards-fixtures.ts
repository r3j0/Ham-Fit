import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_ITEMS } from "../../components/hamster/items";
import type { ItemCatalog } from "../../components/hamster/types";
import type { AvatarOutfit } from "../../lib/avatar-outfit";
import type { Product } from "../../lib/shop-contract";
import { installApi, testOutfit, testRecord } from "./integration-fixtures";
export const rewardId = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const rewardDate = "2026-10-01T00:00:00.000Z";
const renderCatalog: ItemCatalog = structuredClone(DEFAULT_ITEMS);
const assetBodies = new Map<string, Buffer>();
export const shirtAssets: Record<string, string> = {};
for (const variant of ["cream", "gray"] as const) {
  const layer = renderCatalog["mint-shirt"].poses.basic![variant]!.layers[0];
  const body = readFileSync(resolve(__dirname, `../../public${layer.src}`));
  const path = `/api/v1/avatar/assets/${createHash("sha256").update(body).digest("hex")}.png`;
  layer.src = path;
  shirtAssets[variant] = path;
  assetBodies.set(path, body);
}
export const products: Product[] = [
  ...["cream", "gray"].map((v) => ({
    id: `character.${v}`,
    kind: "character" as const,
    renderKey: v,
    slot: null,
    occupiesSlots: [],
    ownershipScope: "shared" as const,
    scopeCharacterId: null,
    saleStatus: "default" as const,
    price: null,
    priceProvisional: false,
    catalogRevision: 1,
  })),
  ...["basic", "curious", "run"].map((v, i) => ({
    id: `pose.${v}`,
    kind: "pose" as const,
    renderKey: v,
    slot: null,
    occupiesSlots: [],
    ownershipScope: "shared" as const,
    scopeCharacterId: null,
    saleStatus: i ? ("on_sale" as const) : ("default" as const),
    price: i ? 50 : null,
    priceProvisional: false,
    catalogRevision: 1,
  })),
  ...([["mint-shirt", "top", "mint-shirt", 25]] as const).map(
    ([id, slot, renderKey, price]) => ({
      id: `clothing.${id}`,
      kind: "clothing" as const,
      renderKey,
      slot,
      occupiesSlots: [slot],
      ownershipScope: "shared" as const,
      scopeCharacterId: null,
      saleStatus: "on_sale" as const,
      price,
      priceProvisional: false,
      catalogRevision: 1,
    }),
  ),
];
export async function installCommerce(page: Page, allOwned = false) {
  await installApi(page, testRecord());
  const state = {
    outfit: structuredClone(testOutfit) as AvatarOutfit,
    balance: 100,
    owned: allOwned
      ? products.map((p) => p.id)
      : ["character.cream", "character.gray", "pose.basic"],
    purchases: [] as { key: string; body: string }[],
    puts: 0,
    losePurchase: false,
    conflict: false,
  };
  const inventory = () => ({
    currency: { balance: state.balance },
    inventory: state.owned.map((productId) => ({
      productId,
      source: "default",
      acquiredAt: rewardDate,
    })),
  });
  const combinations = ["cream", "gray"].flatMap((v) =>
    ["basic", "curious", "run"].flatMap((p) =>
      Array.from({ length: 2 }, (_, mask) => ({
        characterId: `character.${v}`,
        poseId: `pose.${p}`,
        clothingIds: products
          .filter((i) => i.kind === "clothing")
          .filter((_, i) => mask & (1 << i))
          .map((i) => i.id),
      })),
    ),
  );
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace("/api/v1", "");
    if (path === "/avatar/render-catalog")
      return route.fulfill({ json: { revision: 1, catalog: renderCatalog } });
    const asset = assetBodies.get(new URL(req.url()).pathname);
    if (asset) return route.fulfill({ contentType: "image/png", body: asset });
    if (path === "/shop/products")
      return route.fulfill({ json: { products, combinations } });
    if (path === "/users/me/avatar/inventory")
      return route.fulfill({ json: inventory() });
    if (path === "/users/me/avatar/outfit") {
      if (req.method() === "PUT") {
        state.puts++;
        if (state.conflict) {
          state.conflict = false;
          state.outfit.revision++;
          return route.fulfill({
            status: 412,
            json: { code: "OUTFIT_CONFLICT" },
          });
        }
        if (req.headers()["if-match"] !== `"${state.outfit.revision}"`)
          return route.fulfill({
            status: 412,
            json: { code: "OUTFIT_CONFLICT" },
          });
        const body = req.postDataJSON();
        if (
          Object.keys(body).sort().join(",") !==
          "characterId,clothingIds,poseId"
        )
          return route.fulfill({
            status: 400,
            json: {
              code: "INVALID_INPUT",
              message: "요청 형식을 확인해 주세요.",
            },
          });
        state.outfit = {
          ...state.outfit,
          ...body,
          revision: state.outfit.revision + 1,
          rendering: {
            variant: body.characterId.split(".")[1],
            pose: body.poseId.split(".")[1],
            clothing: body.clothingIds.map((id: string) => {
              const p = products.find((p) => p.id === id)!;
              return {
                productId: id,
                slot: p.slot,
                renderKey: p.renderKey,
                occupiesSlots: p.occupiesSlots,
              };
            }),
          },
        };
      }
      return route.fulfill({ json: state.outfit });
    }
    if (path === "/shop/purchases") {
      const body = req.postDataJSON();
      state.purchases.push({
        key: req.headers()["idempotency-key"],
        body: req.postData()!,
      });
      const replayed = state.owned.includes(body.productId),
        p = products.find((p) => p.id === body.productId)!;
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
          ...inventory(),
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
    }
    return route.fallback();
  });
  return state;
}
