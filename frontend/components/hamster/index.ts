export { Hamster, Hamster as NextHamster } from "./Hamster.tsx";
export { POSES, DEFAULT_POSE } from "./poses.ts";
export {
  DEFAULT_ITEMS,
  DEFAULT_OUTFIT,
  ITEM_TARGETS,
  getItemCoverage,
  itemsForSlot,
  defaultOutfit,
} from "./items.ts";
export { resolveHamster } from "./resolve.ts";
export type {
  HamsterProps,
  HamsterPose,
  HamsterVariant,
  HamsterSlot,
  LayerAsset,
  PoseLayers,
  HamsterItem,
  ItemCatalog,
  ItemId,
} from "./types.ts";
export type { RenderSelection, ResolvedLayer } from "./types.ts";
