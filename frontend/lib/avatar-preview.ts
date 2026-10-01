import { avatarPoses, type AvatarOutfit } from "./avatar-outfit";
import { clothingAsset, clothingPlacement } from "./wardrobe-assets";
import { MASCOT_POSES } from "@/components/mascot/mascot-poses.js";
import type { Catalog, OutfitSelection, Product } from "./shop-contract";

export function productName(product: Product) {
  if (product.kind === "character")
    return product.renderKey === "gray"
      ? "그레이 햄스터"
      : product.renderKey === "cream"
        ? "크림 햄스터"
        : "새로운 햄스터";
  if (product.kind === "pose")
    return (
      MASCOT_POSES.find((p) => p.id === product.renderKey)?.label ??
      product.renderKey
    );
  return clothingAsset(product.renderKey)?.name ?? "새로운 의상";
}
export function previewOutfit(
  catalog: Catalog,
  selection: OutfitSelection,
  saved: AvatarOutfit,
): AvatarOutfit | null {
  const character = catalog.products.find(
      (p) => p.id === selection.characterId,
    ),
    pose = catalog.products.find((p) => p.id === selection.poseId);
  if (
    !character ||
    !pose ||
    !["cream", "gray"].includes(character.renderKey) ||
    !avatarPoses.includes(pose.renderKey)
  )
    return null;
  const clothing = selection.clothingIds.map((id) =>
    catalog.products.find((p) => p.id === id),
  );
  if (
    clothing.some(
      (p) =>
        !p ||
        !p.slot ||
        clothingAsset(p.renderKey)?.slot !== p.slot ||
        !clothingPlacement(p.renderKey, pose.renderKey, character.renderKey),
    )
  )
    return null;
  return {
    ...saved,
    ...selection,
    rendering: {
      variant: character.renderKey as AvatarOutfit["rendering"]["variant"],
      pose: pose.renderKey as AvatarOutfit["rendering"]["pose"],
      clothing: clothing.map((p) => ({
        productId: p!.id,
        slot: p!.slot!,
        renderKey: p!.renderKey,
        occupiesSlots: p!.occupiesSlots,
      })),
    },
  };
}
export function selectProduct(
  selection: OutfitSelection,
  product: Product,
  catalog: Catalog,
): OutfitSelection {
  if (product.kind === "character")
    return { ...selection, characterId: product.id };
  if (product.kind === "pose") return { ...selection, poseId: product.id };
  const others = selection.clothingIds.filter((id) => {
    const item = catalog.products.find((p) => p.id === id);
    return (
      item && !item.occupiesSlots.some((s) => product.occupiesSlots.includes(s))
    );
  });
  return {
    ...selection,
    clothingIds: selection.clothingIds.includes(product.id)
      ? others
      : [...others, product.id],
  };
}
