import { GENERATED_ITEMS } from "./catalog.generated.ts";
import type {
  HamsterPose,
  HamsterVariant,
  HamsterSlot,
  ItemCatalog,
} from "./types.ts";
import { POSES } from "./poses.ts";
export const DEFAULT_ITEMS = GENERATED_ITEMS;
export const ITEM_TARGETS = { hat: 30, top: 30, bottom: 30 } as const;
export function getItemCoverage(item: ItemCatalog[string]) {
  const supported: string[] = [];
  for (const pose of Object.keys(POSES) as HamsterPose[])
    for (const variant of ["cream", "gray"] as HamsterVariant[]) {
      if (item.poses[pose]?.[variant] || item.poses[pose]?.shared)
        supported.push(`${pose}/${variant}`);
    }
  return {
    supported,
    frames: supported.length,
    total: 32,
    complete: supported.length === 32,
  };
}
export function itemsForSlot(catalog: ItemCatalog, slot: HamsterSlot) {
  return Object.entries(catalog)
    .filter(([, item]) => item.slot === slot)
    .map(([id, item]) => ({ id, ...item, coverage: getItemCoverage(item) }));
}
/** A demo convenience. Missing slots remain null; no pending artwork is invented. */
export function defaultOutfit(catalog: ItemCatalog = DEFAULT_ITEMS) {
  const first = (slot: HamsterSlot) =>
    itemsForSlot(catalog, slot).find(
      (item) => item.poses.basic?.cream || item.poses.basic?.shared,
    )?.id ?? null;
  return { hat: first("hat"), top: first("top"), bottom: first("bottom") };
}
export const DEFAULT_OUTFIT = defaultOutfit();
