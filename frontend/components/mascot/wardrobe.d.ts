export type WardrobeSlot = "wear";
export type SportswearId =
  | "blue-sportswear"
  | "black-sportswear"
  | "white-sportswear"
  | "green-sportswear";
export type Outfit = { wear?: SportswearId };
export type WardrobeItem = {
  readonly id: SportswearId;
  readonly label: string;
  readonly category: "wear";
  readonly color: string;
  readonly collection: "sport";
  readonly renderMode: "image-swap";
  readonly description: string;
};
export const WARDROBE: readonly WardrobeItem[];
export const CATEGORIES: readonly { id: WardrobeSlot; label: string }[];
export const PRESETS: readonly { id: string; label: string; outfit: Outfit }[];
export function normalizeOutfit(outfit?: unknown): Outfit;
