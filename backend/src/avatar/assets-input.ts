import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const POSES = [
  'basic',
  'cant-hear',
  'curious',
  'drink',
  'droopy',
  'foam-roller',
  'lying',
  'passion',
  'phone',
  'pushup',
  'run',
  'situp',
  'stretch',
  'toilet',
  'victory',
  'weight',
] as const;
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
const supported = z
  .object({ pose: z.enum(POSES), variant: z.enum(['cream', 'gray']) })
  .strict();
const product = z
  .object({
    renderKey: slug,
    slot: z.enum(['hat', 'top', 'bottom']),
    price: z.number().int().positive().max(1000000),
    saleStatus: z.enum(['held', 'on_sale', 'retired']),
    frames: z.array(supported).min(1).max(32),
  })
  .strict();
const combination = z
  .object({
    pose: z.enum(POSES),
    variant: z.enum(['cream', 'gray']),
    clothing: z.array(slug).min(1).max(3),
  })
  .strict();
const publishSchema = z
  .object({
    revision: z.number().int().min(0),
    products: z.array(product).min(1).max(100),
    combinations: z.array(combination).max(2000).default([]),
    reviewed: z.literal(true),
  })
  .strict();
export type PublishInput = z.infer<typeof publishSchema>;
export function parsePublish(value: unknown): PublishInput {
  const parsed = publishSchema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException({
      code: 'INVALID_ASSET_INPUT',
      message:
        '상품 ID, 가격 또는 착용 지원 정보가 올바르지 않습니다. 이미지·배치는 프론트엔드에서 관리하세요.',
    });
  return parsed.data;
}
