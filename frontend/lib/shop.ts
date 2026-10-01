import { api, invalidateUserProfile } from "./session";
import { ApiError, errorMessage } from "./http";
import { invalid } from "./api-contract";
import { parseAvatarOutfit } from "./avatar-outfit";
import {
  parseCatalog,
  parseInventory,
  parsePurchase,
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
  const request = JSON.parse(body) as {
    productId: string;
    catalogRevision: number;
  };
  const { data } = await api<unknown>("/shop/purchases", {
    method: "POST",
    headers: { "X-CSRF-Protection": "1", "Idempotency-Key": key },
    body,
  });
  const saved = parsePurchase(data, request.productId, request.catalogRevision);
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
      ITEM_NOT_OWNED: "보유한 아이템만 착용할 수 있어요.",
      UNSUPPORTED_COMBINATION: "이 자세와 의상은 함께 착용할 수 없어요.",
      OUTFIT_CONFLICT:
        "다른 곳에서 코디를 변경했어요. 최신 코디를 확인한 뒤 다시 선택해 주세요.",
    };
    if (messages[error.code ?? ""]) return messages[error.code!];
  }
  return errorMessage(error);
}
