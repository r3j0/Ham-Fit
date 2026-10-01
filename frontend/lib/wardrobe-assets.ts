import registry from "./wardrobe-assets.json";

export type ClothingSlot = "hat" | "top" | "bottom";
export interface Placement {
  naturalWidth: number;
  naturalHeight: number;
  src: string;
  transform: { x: number; y: number; width: number; rotation: number };
}
export const clothingAssets = registry.items as {
  id: string;
  name: string;
  slot: ClothingSlot;
  placements: Record<string, Placement>;
}[];
export const wardrobeBase = (pose: string) =>
  registry.poses.find((p) => p.id === pose);
export const clothingAsset = (renderKey: string) =>
  clothingAssets.find((i) => i.id === renderKey);
export const clothingPlacement = (
  renderKey: string,
  pose: string,
  variant: string,
) => clothingAsset(renderKey)?.placements[`${pose}:${variant}`];
