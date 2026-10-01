import { avatarPoses, type AvatarOutfit } from "./avatar-outfit";
import { canRenderAvatar, clothingAsset } from "./avatar-rendering.ts";
import { POSES } from "../components/hamster/poses.ts";
import type { HamsterPose, ItemCatalog } from "../components/hamster/types.ts";
import type { Catalog, OutfitSelection, Product } from "./shop-contract";

export function productName(product: Product, assets?: ItemCatalog) {
  if (product.kind === "character")
    return product.renderKey === "gray"
      ? "햄콩이"
      : product.renderKey === "cream"
        ? "햄돌이"
        : "새로운 햄스터";
  if (product.kind === "pose")
    return (
      (Object.hasOwn(POSES, product.renderKey)
        ? POSES[product.renderKey as HamsterPose].label
        : undefined) ?? product.renderKey
    );
  return clothingAsset(product.renderKey, assets)?.label ?? "새로운 의상";
}
export function previewOutfit(
  catalog: Catalog,
  selection: OutfitSelection,
  saved: AvatarOutfit,
  assets?: ItemCatalog,
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
        !p || !p.slot || clothingAsset(p.renderKey, assets)?.slot !== p.slot,
    )
  )
    return null;
  const preview: AvatarOutfit = {
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
  return canRenderAvatar(preview.rendering, assets) ? preview : null;
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
