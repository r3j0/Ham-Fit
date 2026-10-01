export { Hamster, Hamster as NextHamster } from './Hamster';
export { POSES, DEFAULT_POSE } from './poses';
export { DEFAULT_ITEMS, DEFAULT_OUTFIT, ITEM_TARGETS, getItemCoverage, itemsForSlot, defaultOutfit } from './items';
export { resolveHamster } from './resolve';
export type { HamsterProps, HamsterPose, HamsterVariant, HamsterSlot, LayerAsset, PoseLayers, HamsterItem, ItemCatalog, ItemId } from './types';
export type { RenderSelection, ResolvedLayer } from './types';
export { applyPlacements, layerPlacement, placementKey, placementSource, registeredFrame, mergePlacementChanges, PLACEMENT_LIMITS } from './placements';
export type { LayerPlacement, PlacementTarget, PlacementChange, PlacementDocument } from './placements';
