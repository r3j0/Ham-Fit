import {
  invalid,
  integer,
  object,
  text,
  timestamp,
  uuid,
} from "./api-contract.ts";
import { parseAvatarClothing } from "./avatar-outfit.ts";

export interface Product {
  id: string;
  kind: "character" | "pose" | "clothing";
  slot: "hat" | "top" | "bottom" | null;
  occupiesSlots: ("hat" | "top" | "bottom")[];
  renderKey: string;
  ownershipScope: "shared" | "character" | "pending";
  scopeCharacterId: string | null;
  saleStatus: "default" | "on_sale" | "held" | "retired";
  price: number | null;
  priceProvisional: boolean;
  catalogRevision: number;
}
export interface OutfitSelection {
  characterId: string;
  poseId: string;
  clothingIds: string[];
}
export interface Catalog {
  products: Product[];
  combinations: OutfitSelection[];
}
export interface Inventory {
  currency: { balance: number };
  inventory: {
    productId: string;
    source: "default" | "purchase" | "reward" | "streak_roulette";
    acquiredAt: string;
  }[];
}
export function parseProduct(value: unknown): Product {
  const row = object(value);
  if (
    !text(row.id) ||
    !text(row.renderKey) ||
    !["character", "pose", "clothing"].includes(String(row.kind)) ||
    !["shared", "character", "pending"].includes(String(row.ownershipScope)) ||
    !(row.scopeCharacterId === null || text(row.scopeCharacterId)) ||
    (row.ownershipScope === "character") !== (row.scopeCharacterId !== null) ||
    !["default", "on_sale", "held", "retired"].includes(
      String(row.saleStatus),
    ) ||
    !(row.price === null || integer(row.price, 1)) ||
    (row.saleStatus === "on_sale" && row.price === null) ||
    typeof row.priceProvisional !== "boolean" ||
    !integer(row.catalogRevision, 1) ||
    !Array.isArray(row.occupiesSlots)
  )
    invalid();
  if (row.kind === "clothing")
    parseAvatarClothing({ ...row, productId: row.id });
  else if (row.slot !== null || row.occupiesSlots.length !== 0) invalid();
  return row as unknown as Product;
}
export function parseCatalog(value: unknown): Catalog {
  const row = object(value);
  if (!Array.isArray(row.products) || !Array.isArray(row.combinations))
    invalid();
  const products = row.products.map(parseProduct),
    byId = new Map(products.map((p) => [p.id, p]));
  if (byId.size !== products.length) invalid();
  const combinations = row.combinations.map((value) => {
    const c = object(value);
    if (
      !text(c.characterId) ||
      !text(c.poseId) ||
      byId.get(c.characterId)?.kind !== "character" ||
      byId.get(c.poseId)?.kind !== "pose" ||
      !Array.isArray(c.clothingIds) ||
      !c.clothingIds.every(
        (id) => text(id) && byId.get(id)?.kind === "clothing",
      ) ||
      new Set(c.clothingIds).size !== c.clothingIds.length
    )
      invalid();
    const clothes = c.clothingIds.map((id) => byId.get(id)!);
    const slots = clothes.flatMap((p) => p.occupiesSlots);
    if (
      new Set(slots).size !== slots.length ||
      clothes.some(
        (p) =>
          p.ownershipScope === "character" &&
          p.scopeCharacterId !== c.characterId,
      )
    )
      invalid();
    return c as unknown as OutfitSelection;
  });
  return { products, combinations };
}
export function parseInventory(value: unknown): Inventory {
  const row = object(value),
    currency = object(row.currency);
  if (!integer(currency.balance) || !Array.isArray(row.inventory)) invalid();
  const ids = new Set();
  for (const value of row.inventory) {
    const item = object(value);
    if (
      !text(item.productId) ||
      ids.has(item.productId) ||
      !["default", "purchase", "reward", "streak_roulette"].includes(
        String(item.source),
      ) ||
      !timestamp(item.acquiredAt)
    )
      invalid();
    ids.add(item.productId);
  }
  return row as unknown as Inventory;
}
export function parsePurchase(
  value: unknown,
  productId: string,
  revision: number,
) {
  const row = object(value),
    purchase = object(row.purchase);
  const inventory = parseInventory(row);
  if (
    typeof row.replayed !== "boolean" ||
    !uuid(purchase.id) ||
    purchase.productId !== productId ||
    purchase.catalogRevision !== revision ||
    !integer(purchase.price, 1) ||
    !timestamp(purchase.createdAt) ||
    !inventory.inventory.some((i) => i.productId === productId)
  )
    invalid();
  return inventory;
}
export function parseBatchPurchase(
  value: unknown,
  items: { productId: string; catalogRevision: number }[],
) {
  const row = object(value);
  if (
    !Array.isArray(row.purchases) ||
    row.purchases.length !== items.length ||
    items.length < 2 ||
    items.length > 4 ||
    new Set(items.map((item) => item.productId)).size !== items.length ||
    !integer(row.totalPrice, 1)
  )
    invalid();
  const receipts = row.purchases.map(object);
  if (new Set(receipts.map((p) => p.id)).size !== items.length) invalid();
  for (const item of items) {
    const matches = receipts.filter((p) => p.productId === item.productId);
    if (matches.length !== 1) invalid();
    parsePurchase(
      { ...row, purchase: matches[0] },
      item.productId,
      item.catalogRevision,
    );
  }
  if (
    receipts.reduce((total, p) => total + (p.price as number), 0) !==
    row.totalPrice
  )
    invalid();
  return parseInventory(row);
}
export function sameSelection(a: OutfitSelection, b: OutfitSelection) {
  return (
    a.characterId === b.characterId &&
    a.poseId === b.poseId &&
    a.clothingIds.length === b.clothingIds.length &&
    a.clothingIds.every((id) => b.clothingIds.includes(id))
  );
}
export const supportedSelection = (
  catalog: Catalog,
  selection: OutfitSelection,
) => catalog.combinations.some((c) => sameSelection(c, selection));
