import { api, invalidateUserProfile } from "./session";
import { ApiError, errorMessage } from "./http";
import { invalid } from "./api-contract";
import { parseAvatarOutfit } from "./avatar-outfit";
import {
  parseCatalog,
  parseInventory,
  parsePurchase,
  parseBatchPurchase,
  sameSelection,
  type OutfitSelection,
} from "./shop-contract";

export const getCatalog = (signal?: AbortSignal) =>
  api<unknown>("/shop/products", { signal }).then(({ data }) =>
    parseCatalog(data),
  );
export const getInventory = (signal?: AbortSignal) =>
  api<unknown>("/users/me/avatar/inventory", { signal }).then(({ data }) =>
    parseInventory(data),
  );
export const getOutfit = (signal?: AbortSignal) =>
  api<unknown>("/users/me/avatar/outfit", { signal }).then(({ data }) =>
    parseAvatarOutfit(data),
  );
export async function saveOutfit(selection: OutfitSelection, revision: number) {
  const { data } = await api<unknown>("/users/me/avatar/outfit", {
    method: "PUT",
    headers: { "X-CSRF-Protection": "1", "If-Match": `"${revision}"` },
    body: JSON.stringify({
      characterId: selection.characterId,
      poseId: selection.poseId,
      clothingIds: selection.clothingIds,
    }),
  });
  const saved = parseAvatarOutfit(data);
  if (!sameSelection(saved, selection)) invalid();
  invalidateUserProfile();
  return saved;
}
export async function purchase(body: string, key: string) {
  type Item = { productId: string; catalogRevision: number };
  const request = JSON.parse(body) as Item | { items: Item[] };
  const batch = "items" in request;
  const { data } = await api<unknown>(
    batch ? "/shop/purchases/batch" : "/shop/purchases",
    {
      method: "POST",
      headers: { "X-CSRF-Protection": "1", "Idempotency-Key": key },
      body,
    },
  ).catch((error: unknown) => {
    // An older API deployment lacks the batch route. Never substitute single
    // purchases: that could charge for only part of the confirmed bundle.
    if (
      batch &&
      error instanceof ApiError &&
      error.status === 404 &&
      !error.code
    )
      throw new ApiError(
        404,
        "전체 구매 기능을 준비 중이에요. 잠시 후 다시 시도해 주세요.",
        {},
        undefined,
        "SHOP_BATCH_UNAVAILABLE",
      );
    throw error;
  });
  const saved = batch
    ? parseBatchPurchase(data, request.items)
    : parsePurchase(data, request.productId, request.catalogRevision);
  invalidateUserProfile();
  return saved;
}
export function shopError(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      INSUFFICIENT_FUNDS: "해바라기씨가 부족해요.",
      CATALOG_CHANGED:
        "상품 정보가 변경되었어요. 최신 가격을 확인한 뒤 다시 구매해 주세요.",
      ALREADY_OWNED: "이미 보유한 아이템이에요. 옷장을 확인해 주세요.",
      PRODUCT_NOT_FOUND:
        "상품을 찾을 수 없어요. 상품 목록을 새로 확인해 주세요.",
      SHOP_BATCH_UNAVAILABLE:
        "전체 구매 기능을 준비 중이에요. 잠시 후 다시 시도해 주세요.",
      ITEM_NOT_OWNED: "보유한 아이템만 착용할 수 있어요.",
      UNSUPPORTED_COMBINATION:
        "이 캐릭터·자세에서 지원하지 않는 의상이 있어요.",
      OUTFIT_CONFLICT:
        "다른 곳에서 코디를 변경했어요. 최신 코디를 확인한 뒤 다시 선택해 주세요.",
    };
    if (messages[error.code ?? ""]) return messages[error.code!];
  }
  return errorMessage(error);
}
