import { HttpException } from '@nestjs/common';
import { z } from 'zod';

export function avatarError(
  status: number,
  code: string,
  message: string,
): never {
  throw new HttpException({ statusCode: status, code, message }, status);
}
const productId = z.string().regex(/^[a-z][a-z0-9.-]{0,99}$/);
const purchaseSchema = z.strictObject({
  productId,
  catalogRevision: z.number().int().positive().max(2147483647),
});
const batchPurchaseSchema = z.strictObject({
  items: z
    .array(purchaseSchema)
    .min(2)
    .max(4)
    .refine(
      (items) =>
        new Set(items.map((item) => item.productId)).size === items.length,
    ),
});
const outfitSchema = z.strictObject({
  characterId: productId,
  poseId: productId,
  clothingIds: z.array(productId).max(3),
});
export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type BatchPurchaseInput = z.infer<typeof batchPurchaseSchema>;
export type OutfitInput = z.infer<typeof outfitSchema>;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    avatarError(400, 'INVALID_INPUT', '요청 형식을 확인해 주세요.');
  return result.data;
}
export const parsePurchase = (input: unknown) => parse(purchaseSchema, input);
export const parseBatchPurchase = (input: unknown) =>
  parse(batchPurchaseSchema, input);
export const parseOutfit = (input: unknown) => parse(outfitSchema, input);
export const parsePurchaseKey = (input: unknown) =>
  parse(z.uuid(), input).toLowerCase();
export function parseOutfitRevision(input: unknown) {
  if (input === undefined)
    avatarError(428, 'REVISION_REQUIRED', 'If-Match가 필요합니다.');
  if (typeof input !== 'string' || !/^"[1-9]\d{0,9}"$/.test(input))
    avatarError(400, 'INVALID_REVISION', 'If-Match 형식을 확인해 주세요.');
  const revision = Number(input.slice(1, -1));
  if (revision > 2147483647)
    avatarError(400, 'INVALID_REVISION', 'revision 범위를 확인해 주세요.');
  return revision;
}
export function combinationId(input: OutfitInput) {
  return JSON.stringify([
    input.characterId,
    input.poseId,
    [...input.clothingIds].sort(),
  ]);
}
