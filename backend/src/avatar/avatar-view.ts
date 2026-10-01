import { ServiceUnavailableException } from '@nestjs/common';
import type {
  AvatarOutfit,
  AvatarProduct,
  Prisma,
} from '../generated/prisma/client.js';

const combinationItems = {
  items: { include: { product: true }, orderBy: { productId: 'asc' as const } },
} satisfies Prisma.AvatarCombinationInclude;
type Outfit = AvatarOutfit & {
  combination: Prisma.AvatarCombinationGetPayload<{
    include: typeof combinationItems;
  }> & { character: AvatarProduct; pose: AvatarProduct };
};

export async function outfitRelations(
  tx: Prisma.TransactionClient,
  outfits: AvatarOutfit[],
): Promise<Map<string, Outfit>> {
  if (!outfits.length) return new Map();
  // One relation chain at a time keeps the transaction client sequential;
  // shared combinations and rendering products are loaded once for the batch.
  const combinations = await tx.avatarCombination.findMany({
    where: {
      id: { in: [...new Set(outfits.map((row) => row.combinationId))] },
    },
    include: combinationItems,
  });
  const products = await tx.avatarProduct.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            combinations.flatMap((row) => [row.characterId, row.poseId]),
          ),
        ],
      },
    },
  });
  const combinationsById = new Map(combinations.map((row) => [row.id, row]));
  const productsById = new Map(products.map((row) => [row.id, row]));
  // Required combination/product references are enforced by foreign keys.
  return new Map(
    outfits.map((outfit) => {
      const combination = combinationsById.get(outfit.combinationId)!;
      return [
        outfit.userId,
        {
          ...outfit,
          combination: {
            ...combination,
            character: productsById.get(combination.characterId)!,
            pose: productsById.get(combination.poseId)!,
          },
        },
      ];
    }),
  );
}

export function outfitView(row: Outfit | null) {
  if (!row)
    throw new ServiceUnavailableException(
      '대표 코디 정보가 누락되었습니다. 관리자 확인이 필요합니다.',
    );
  const combination = row.combination;
  return {
    characterId: combination.characterId,
    poseId: combination.poseId,
    clothingIds: combination.items.map((item) => item.productId),
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    rendering: {
      variant: combination.character.renderKey,
      pose: combination.pose.renderKey,
      clothing: combination.items.map(({ product }) => ({
        productId: product.id,
        slot: product.slot,
        renderKey: product.renderKey,
        occupiesSlots: product.occupiesSlots,
      })),
    },
  };
}
