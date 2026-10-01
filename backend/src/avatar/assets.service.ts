import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { combinationId } from './avatar-input.js';
import { parsePublish } from './assets-input.js';
import type { PublishInput } from './assets-input.js';

@Injectable()
export class AvatarAssetsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async managerCatalog() {
    const row = await this.db.avatarRenderCatalog.findUnique({
      where: { id: 'wardrobe' },
      select: { revision: true },
    });
    const products = await this.db.avatarProduct.findMany({
      where: { kind: 'clothing' },
      select: { id: true, renderKey: true, price: true, saleStatus: true },
    });
    return {
      revision: row?.revision ?? 0,
      products,
      imageStorage: 'frontend',
    };
  }
  async publish(value: unknown) {
    const input = parsePublish(value);
    this.validateTopology(input);
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
        // A conditional UPDATE holds the row lock until the prices and supported combinations commit together.
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
        const existingProducts = await tx.avatarProduct.findMany({
          where: {
            id: { in: input.products.map((p) => `clothing.${p.renderKey}`) },
          },
        });
        const existingById = new Map(existingProducts.map((p) => [p.id, p]));
        for (const product of input.products) {
          const id = `clothing.${product.renderKey}`;
          const existing = existingById.get(id);
          if (
            existing &&
            (existing.kind !== 'clothing' ||
              existing.slot !== product.slot ||
              existing.renderKey !== product.renderKey)
          )
            throw new BadRequestException(
              '기존 상품의 슬롯과 식별자를 변경할 수 없습니다.',
            );
          if (
            existing &&
            existing.price === product.price &&
            existing.saleStatus === product.saleStatus &&
            !existing.priceProvisional
          )
            continue;
          await tx.avatarProduct.upsert({
            where: { id },
            create: {
              id,
              kind: 'clothing',
              slot: product.slot,
              occupiesSlots: [product.slot],
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
          ...input.products.flatMap((product) =>
            product.frames.map((frame) => ({
              ...frame,
              clothing: [product.renderKey],
            })),
          ),
          ...input.combinations,
        ];
        const poseIds = [...new Set(combinations.map((c) => c.pose))];
        await tx.avatarProduct.createMany({
          data: poseIds.map((pose) => ({
            id: `pose.${pose}`,
            kind: 'pose',
            slot: null,
            occupiesSlots: [],
            renderKey: pose,
            ownershipScope: 'shared',
            saleStatus: pose === 'basic' ? 'default' : 'held',
            price: null,
            priceProvisional: false,
          })),
          skipDuplicates: true,
        });
        const rows = new Map<
          string,
          {
            id: string;
            characterId: string;
            poseId: string;
            clothingIds: string[];
          }
        >();
        for (const combination of combinations) {
          const characterId = `character.${combination.variant}`,
            poseId = `pose.${combination.pose}`;
          const clothingIds = combination.clothing
            .map((key) => `clothing.${key}`)
            .sort((a, b) => a.localeCompare(b));
          const id = combinationId({ characterId, poseId, clothingIds });
          rows.set(id, { id, characterId, poseId, clothingIds });
        }
        const existingCombinations = await tx.avatarCombination.findMany({
          where: { id: { in: [...rows.keys()] } },
          select: { id: true },
        });
        const registered = new Set(existingCombinations.map((row) => row.id));
        const supported = [...rows.values()].filter(
          (row) => !registered.has(row.id),
        );
        // Only new parents and items are inserted in this transaction; existing
        // immutable items reject even a duplicate INSERT from a later transaction.
        // Three bulk inserts replace a separate upsert for every supported frame.
        if (supported.length) {
          await tx.avatarCombination.createMany({
            data: supported.map(({ id, characterId, poseId }) => ({
              id,
              characterId,
              poseId,
            })),
            skipDuplicates: true,
          });
          await tx.avatarCombinationItem.createMany({
            data: supported.flatMap((row) =>
              row.clothingIds.map((productId) => ({
                combinationId: row.id,
                productId,
              })),
            ),
            skipDuplicates: true,
          });
        }
        const row = await tx.avatarRenderCatalog.update({
          where: { id: 'wardrobe' },
          data: {
            // Retire legacy display JSON only after a successful frontend-backed registration.
            catalog: {},
            sourceCatalog: {},
          },
        });
        return {
          revision: row.revision,
          updatedAt: row.updatedAt.toISOString(),
        };
      },
      { timeout: 30000 },
    );
  }
  private validateTopology(input: PublishInput) {
    const products = new Map(
      input.products.map((product) => [product.renderKey, product]),
    );
    if (products.size !== input.products.length)
      throw new BadRequestException('상품 ID가 중복되었습니다.');
    for (const c of input.combinations) {
      const slots = c.clothing.map((key) => products.get(key)?.slot);
      if (
        slots.some((slot) => !slot) ||
        new Set(slots).size !== slots.length ||
        c.clothing.some(
          (key) =>
            !products
              .get(key)
              ?.frames.some(
                (f) => f.pose === c.pose && f.variant === c.variant,
              ),
        )
      )
        throw new BadRequestException(
          '검수한 착용 조합의 상품·슬롯·자세가 올바르지 않습니다.',
        );
    }
  }
}
