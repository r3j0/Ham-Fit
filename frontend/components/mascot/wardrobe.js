/** Image-based outfits. Unknown/retired items are deliberately discarded. */
export const WARDROBE = Object.freeze(
  [
    {
      id: "blue-sportswear",
      label: "파랑 스포츠웨어",
      category: "wear",
      color: "#68a9df",
      collection: "sport",
      renderMode: "image-swap",
      description: "파란 줄무늬 상의와 스포츠 반바지",
    },
    {
      id: "black-sportswear",
      label: "검은 스포츠웨어",
      category: "wear",
      color: "#2c2c2c",
      collection: "sport",
      renderMode: "image-swap",
      description: "검은 반팔 상의와 스포츠 반바지",
    },
    {
      id: "white-sportswear",
      label: "흰 스포츠웨어",
      category: "wear",
      color: "#f7f7f7",
      collection: "sport",
      renderMode: "image-swap",
      description: "분홍 라인의 흰 반팔 상의와 스포츠 반바지",
    },
    {
      id: "green-sportswear",
      label: "초록 스포츠웨어",
      category: "wear",
      color: "#77ad62",
      collection: "sport",
      renderMode: "image-swap",
      description: "초록 긴팔 상의와 스포츠 반바지",
    },
  ].map(Object.freeze),
);
export const CATEGORIES = Object.freeze([{ id: "wear", label: "웨어" }]);
export const PRESETS = Object.freeze(
  WARDROBE.map(({ id, label }) =>
    Object.freeze({ id, label, outfit: Object.freeze({ wear: id }) }),
  ),
);
export function normalizeOutfit(outfit = {}) {
  return WARDROBE.some((item) => item.id === outfit?.wear)
    ? { wear: outfit.wear }
    : {};
}
