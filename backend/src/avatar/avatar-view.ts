import { ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

export const combinationInclude = {
  character: true,
  pose: true,
  items: { include: { product: true }, orderBy: { productId: 'asc' as const } },
} satisfies Prisma.AvatarCombinationInclude;
export const outfitInclude = {
  combination: { include: combinationInclude },
} satisfies Prisma.AvatarOutfitInclude;
type Outfit = Prisma.AvatarOutfitGetPayload<{ include: typeof outfitInclude }>;
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
