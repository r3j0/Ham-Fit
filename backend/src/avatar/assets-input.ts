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
export const imagePath = /^\/api\/v1\/avatar\/assets\/([a-f0-9]{64})\.png$/;
const layer = z
  .object({
    src: z.string().regex(imagePath),
    x: z.number().min(-2000).max(2000).optional(),
    y: z.number().min(-2000).max(2000).optional(),
    width: z.number().min(1).max(4000).optional(),
    height: z.number().min(1).max(4000).optional(),
    rotation: z.number().min(-180).max(180).optional(),
    opacity: z.number().min(0).max(1).optional(),
    fit: z.enum(['contain', 'stretch']).optional(),
    zIndex: z.number().min(-1000).max(1000),
  })
  .strict();
const frame = z
  .object({
    layers: z.array(layer).min(1).max(16),
    foreground: z.array(layer).max(16).optional(),
    qa: z
      .object({
        status: z.literal('passed'),
        reviewer: z.string().trim().min(1).max(200),
        reviewedAt: z.iso.datetime({ offset: true }),
      })
      .passthrough(),
  })
  .strict();
const variants = z.partialRecord(z.enum(['cream', 'gray', 'shared']), frame);
export const catalogSchema = z
  .record(
    slug,
    z
      .object({
        slot: z.enum(['hat', 'top', 'bottom']),
        label: z.string().trim().min(1).max(100),
        setId: slug.optional(),
        poses: z.partialRecord(z.enum(POSES), variants),
      })
      .strict(),
  )
  .refine(
    (catalog) => Object.keys(catalog).length <= 100,
    'At most 100 clothing items',
  );
export type RenderCatalog = z.infer<typeof catalogSchema>;
export type AssetLayer = z.infer<typeof layer>;
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
    catalog: catalogSchema,
    sourceCatalog: catalogSchema,
    products: z
      .array(
        z
          .object({
            renderKey: slug,
            price: z.number().int().positive().max(1000000),
            saleStatus: z.enum(['held', 'on_sale', 'retired']),
          })
          .strict(),
      )
      .max(100),
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
      message: '의상, 배치, 가격 또는 검수 정보가 올바르지 않습니다.',
    });
  return parsed.data;
}
export function eachLayer(
  catalog: RenderCatalog,
  visit: (layer: AssetLayer, original: boolean) => void,
  original = false,
) {
  for (const item of Object.values(catalog))
    for (const variants of Object.values(item.poses))
      for (const frame of Object.values(variants ?? {})) {
        if (frame)
          for (const layer of [...frame.layers, ...(frame.foreground ?? [])])
            visit(layer, original);
      }
}
export function supportedFrames(catalog: RenderCatalog) {
  return Object.entries(catalog).flatMap(([renderKey, item]) =>
    Object.entries(item.poses).flatMap(([pose, variants]) =>
      (['cream', 'gray'] as const)
        .filter((variant) => variants?.[variant] || variants?.shared)
        .map((variant) => ({ renderKey, pose, variant })),
    ),
  );
}
