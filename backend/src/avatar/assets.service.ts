import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { combinationId } from './avatar-input.js';
import { AvatarAssetFiles } from './assets-files.js';
import {
  eachLayer,
  imagePath,
  parsePublish,
  supportedFrames,
} from './assets-input.js';
import type { PublishInput, RenderCatalog } from './assets-input.js';

@Injectable()
export class AvatarAssetsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AvatarAssetFiles) private readonly files: AvatarAssetFiles,
  ) {}
  async catalog() {
    const row = await this.db.avatarRenderCatalog.findUnique({
      where: { id: 'wardrobe' },
    });
    return {
      revision: row?.revision ?? 0,
      catalog: row?.catalog ?? {},
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
  async managerCatalog() {
    const row = await this.db.avatarRenderCatalog.findUnique({
      where: { id: 'wardrobe' },
    });
    const products = await this.db.avatarProduct.findMany({
      where: { kind: 'clothing' },
      select: { id: true, renderKey: true, price: true, saleStatus: true },
    });
    return {
      revision: row?.revision ?? 0,
      catalog: row?.catalog ?? {},
      sourceCatalog: row?.sourceCatalog ?? {},
      products,
      imageStorage: this.files.storageKind(),
    };
  }
  async publish(value: unknown) {
    const input = parsePublish(value);
    this.validateTopology(input);
    const sources = new Map<string, boolean>();
    eachLayer(input.catalog, (layer) =>
      sources.set(
        imagePath.exec(layer.src)![1],
        sources.get(imagePath.exec(layer.src)![1]) ?? false,
      ),
    );
    eachLayer(input.sourceCatalog, (layer) =>
      sources.set(imagePath.exec(layer.src)![1], true),
    );
    const checks = [...sources];
    for (let index = 0; index < checks.length; index += 8) {
      await Promise.all(
        checks
          .slice(index, index + 8)
          .map(([hash, original]) =>
            this.files.verify(`${hash}.png`, original),
          ),
      );
    }
    return this.db.$transaction(
      async (tx) => {
        await tx.avatarRenderCatalog.upsert({
          where: { id: 'wardrobe' },
          create: {
            id: 'wardrobe',
            revision: 0,
            catalog: {},
            sourceCatalog: {},
          },
          update: {},
        });
        // A conditional UPDATE holds the row lock until the products, combinations and assets commit together.
        const changed = await tx.avatarRenderCatalog.updateMany({
          where: { id: 'wardrobe', revision: input.revision },
          data: { revision: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException({
            code: 'ASSET_CONFLICT',
            message:
              '다른 관리자가 등록했습니다. 서버 버전을 확인한 후 다시 등록하세요.',
          });
        const previous = await tx.avatarRenderCatalog.findUniqueOrThrow({
          where: { id: 'wardrobe' },
        });
        const previousCatalog = previous.catalog as RenderCatalog;
        const supported = new Set(
          supportedFrames(input.catalog).map(
            (f) => `${f.renderKey}/${f.pose}/${f.variant}`,
          ),
        );
        if (
          supportedFrames(previousCatalog).some(
            (f) => !supported.has(`${f.renderKey}/${f.pose}/${f.variant}`),
          )
        )
          throw new BadRequestException(
            '기존에 등록한 의상·자세·색상은 제거할 수 없습니다. 기존 소유자의 표시를 유지해야 합니다.',
          );
        for (const product of input.products) {
          const item = input.catalog[product.renderKey];
          const id = `clothing.${product.renderKey}`;
          const existing = await tx.avatarProduct.findUnique({ where: { id } });
          if (
            existing &&
            (existing.kind !== 'clothing' ||
              existing.slot !== item.slot ||
              existing.renderKey !== product.renderKey)
          )
            throw new BadRequestException(
              '기존 상품의 슬롯과 식별자를 변경할 수 없습니다.',
            );
          await tx.avatarProduct.upsert({
            where: { id },
            create: {
              id,
              kind: 'clothing',
              slot: item.slot,
              occupiesSlots: [item.slot],
              renderKey: product.renderKey,
              ownershipScope: 'shared',
              saleStatus: product.saleStatus,
              price: product.price,
              priceProvisional: false,
            },
            update: {
              price: product.price,
              saleStatus: product.saleStatus,
              priceProvisional: false,
            },
          });
        }
        const combinations = [
          ...supportedFrames(input.catalog).map((f) => ({
            pose: f.pose,
            variant: f.variant,
            clothing: [f.renderKey],
          })),
          ...input.combinations,
        ];
        for (const combination of combinations) {
          const characterId = `character.${combination.variant}`,
            poseId = `pose.${combination.pose}`;
          await tx.avatarProduct.upsert({
            where: { id: poseId },
            create: {
              id: poseId,
              kind: 'pose',
              slot: null,
              occupiesSlots: [],
              renderKey: combination.pose,
              ownershipScope: 'shared',
              saleStatus: 'held',
              price: null,
              priceProvisional: false,
            },
            update: {},
          });
          const clothingIds = combination.clothing
            .map((key) => `clothing.${key}`)
            .sort((a, b) => a.localeCompare(b));
          const id = combinationId({ characterId, poseId, clothingIds });
          await tx.avatarCombination.upsert({
            where: { id },
            create: {
              id,
              characterId,
              poseId,
              items: {
                create: clothingIds.map((productId) => ({ productId })),
              },
            },
            update: {},
          });
        }
        const row = await tx.avatarRenderCatalog.update({
          where: { id: 'wardrobe' },
          data: {
            catalog: input.catalog as Prisma.InputJsonValue,
            sourceCatalog: input.sourceCatalog as Prisma.InputJsonValue,
          },
        });
        return {
          revision: row.revision,
          catalog: row.catalog,
          updatedAt: row.updatedAt.toISOString(),
        };
      },
      { timeout: 30000 },
    );
  }
  private validateTopology(input: PublishInput) {
    const ids = Object.keys(input.catalog).sort((a, b) => a.localeCompare(b));
    if (
      !ids.length ||
      JSON.stringify(ids) !==
        JSON.stringify(
          Object.keys(input.sourceCatalog).sort((a, b) => a.localeCompare(b)),
        ) ||
      input.products.length !== ids.length ||
      new Set(input.products.map((p) => p.renderKey)).size !== ids.length ||
      input.products.some((p) => !ids.includes(p.renderKey))
    )
      throw new BadRequestException(
        '모든 의상의 원본과 가격을 함께 등록해야 합니다.',
      );
    for (const id of ids) {
      const item = input.catalog[id],
        source = input.sourceCatalog[id];
      const topology = (value: typeof item) =>
        JSON.stringify(
          Object.entries(value.poses)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([pose, variants]) => [
              pose,
              Object.entries(variants ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([variant, frame]) => [
                  variant,
                  frame?.layers.length,
                  frame?.foreground?.length ?? 0,
                ]),
            ]),
        );
      if (
        item.slot !== source.slot ||
        topology(item) !== topology(source) ||
        !supportedFrames({ [id]: item }).length
      )
        throw new BadRequestException(
          '원본과 수정본의 자세·레이어 구성이 일치해야 합니다.',
        );
    }
    for (const c of input.combinations) {
      const slots = c.clothing.map((key) => input.catalog[key]?.slot);
      if (
        slots.some((s) => !s) ||
        new Set(slots).size !== slots.length ||
        c.clothing.some(
          (key) =>
            !input.catalog[key]?.poses[c.pose]?.[c.variant] &&
            !input.catalog[key]?.poses[c.pose]?.shared,
        )
      )
        throw new BadRequestException(
          '검수한 착용 조합의 의상·슬롯·자세가 올바르지 않습니다.',
        );
    }
  }
}
