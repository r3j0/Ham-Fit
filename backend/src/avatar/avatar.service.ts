import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AvatarProduct } from '../generated/prisma/client.js';
import { avatarError, combinationId } from './avatar-input.js';
import type { OutfitInput, PurchaseInput } from './avatar-input.js';
import { outfitInclude, outfitView } from './avatar-view.js';

@Injectable()
export class AvatarService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async catalog() {
    return this.database.$transaction(
      async (tx) => ({
        products: await tx.avatarProduct.findMany({ orderBy: { id: 'asc' } }),
        // Explicit whole combinations also let FE filter unsupported previews.
        combinations: (
          await tx.avatarCombination.findMany({
            include: { items: { orderBy: { productId: 'asc' } } },
            orderBy: { id: 'asc' },
          })
        ).map((row) => ({
          characterId: row.characterId,
          poseId: row.poseId,
          clothingIds: row.items.map((item) => item.productId),
        })),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    if (!rows.length) throw new UnauthorizedException('계정이 삭제되었습니다.');
  }

  private async state(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { currency: { select: { balance: true } } },
    });
    if (!user) throw new UnauthorizedException('계정이 삭제되었습니다.');
    if (!user.currency)
      avatarError(503, 'CURRENCY_MISSING', '재화 정보가 누락되었습니다.');
    return {
      currency: user.currency,
      inventory: await tx.avatarOwnership.findMany({
        where: { userId },
        orderBy: { productId: 'asc' },
        select: { productId: true, source: true, acquiredAt: true },
      }),
    };
  }

  inventory(userId: string) {
    return this.database.$transaction((tx) => this.state(tx, userId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  async outfit(userId: string) {
    return this.database.$transaction(
      async (tx) => {
        if (
          !(await tx.user.findUnique({
            where: { id: userId },
            select: { id: true },
          }))
        )
          throw new UnauthorizedException('계정이 삭제되었습니다.');
        return outfitView(
          await tx.avatarOutfit.findUnique({
            where: { userId },
            include: outfitInclude,
          }),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async saveOutfit(userId: string, revision: number, input: OutfitInput) {
    return this.database.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const current = await tx.avatarOutfit.findUnique({ where: { userId } });
      if (!current)
        avatarError(503, 'OUTFIT_MISSING', '대표 코디 정보가 누락되었습니다.');
      if (current.revision !== revision)
        avatarError(
          412,
          'OUTFIT_CONFLICT',
          '다른 기기에서 코디가 변경되었습니다. 다시 조회해 주세요.',
        );
      const ids = [input.characterId, input.poseId, ...input.clothingIds];
      if (new Set(ids).size !== ids.length)
        avatarError(
          400,
          'SLOT_CONFLICT',
          '같은 아이템을 중복 착용할 수 없습니다.',
        );
      const products = await tx.avatarProduct.findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      if (
        products.length !== ids.length ||
        byId.get(input.characterId)?.kind !== 'character' ||
        byId.get(input.poseId)?.kind !== 'pose' ||
        input.clothingIds.some((id) => byId.get(id)?.kind !== 'clothing')
      )
        avatarError(
          400,
          'INVALID_PRODUCT_KIND',
          '캐릭터·자세·의상 식별자를 확인해 주세요.',
        );
      const slots = new Set<string>();
      for (const product of products) {
        if (
          product.scopeCharacterId &&
          product.scopeCharacterId !== input.characterId
        )
          avatarError(
            422,
            'UNSUPPORTED_COMBINATION',
            '해당 캐릭터 전용 아이템이 아닙니다.',
          );
        for (const slot of product.occupiesSlots) {
          if (slots.has(slot))
            avatarError(
              400,
              'SLOT_CONFLICT',
              '같은 부위의 의상을 중복 착용할 수 없습니다.',
            );
          slots.add(slot);
        }
      }
      if (
        (await tx.avatarOwnership.count({
          where: { userId, productId: { in: ids } },
        })) !== ids.length
      )
        avatarError(
          403,
          'ITEM_NOT_OWNED',
          '보유한 아이템만 저장할 수 있습니다.',
        );
      const id = combinationId(input);
      if (!(await tx.avatarCombination.findUnique({ where: { id } })))
        avatarError(
          422,
          'UNSUPPORTED_COMBINATION',
          '지원하지 않는 렌더링 조합입니다.',
        );
      // Whole outfit is a single immutable combination reference, so readers
      // cannot see a new character paired with old clothing during a save.
      return outfitView(
        await tx.avatarOutfit.update({
          where: { userId },
          data: { combinationId: id, revision: { increment: 1 } },
          include: outfitInclude,
        }),
      );
    });
  }

  async purchase(userId: string, key: string, input: PurchaseInput) {
    return this.database.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const previous = await tx.avatarPurchase.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (previous) {
        if (
          previous.productId !== input.productId ||
          previous.catalogRevision !== input.catalogRevision
        )
          avatarError(
            409,
            'IDEMPOTENCY_CONFLICT',
            '같은 요청 키에 다른 구매 내용을 사용할 수 없습니다.',
          );
        return {
          replayed: true,
          purchase: this.purchaseView(previous),
          ...(await this.state(tx, userId)),
        };
      }
      // FOR SHARE permits other buyers but serializes price/status updates.
      // Whichever transaction obtains this lock first defines the sale terms.
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM ${this.database.table('avatar_products')} WHERE id = ${input.productId} FOR SHARE`;
      if (!rows.length)
        avatarError(404, 'PRODUCT_NOT_FOUND', '상품을 찾을 수 없습니다.');
      const product = await tx.avatarProduct.findUniqueOrThrow({
        where: { id: input.productId },
      });
      this.assertSale(product);
      if (product.catalogRevision !== input.catalogRevision)
        avatarError(
          409,
          'CATALOG_CHANGED',
          '상품 가격 또는 판매 조건이 변경되었습니다. 다시 조회해 주세요.',
        );
      if (
        await tx.avatarOwnership.findUnique({
          where: { userId_productId: { userId, productId: input.productId } },
        })
      )
        avatarError(409, 'ALREADY_OWNED', '이미 보유한 아이템입니다.');
      const price = product.price!;
      // The guarded UPDATE also locks the actual currency row, so unrelated
      // currency writers cannot cause a lost update or an overdraw.
      const debit = await tx.userCurrency.updateMany({
        where: { userId, balance: { gte: price } },
        data: { balance: { decrement: price } },
      });
      if (!debit.count) {
        if (!(await tx.userCurrency.findUnique({ where: { userId } })))
          avatarError(503, 'CURRENCY_MISSING', '재화 정보가 누락되었습니다.');
        avatarError(409, 'INSUFFICIENT_FUNDS', '해바라기씨가 부족합니다.');
      }
      const purchase = await tx.avatarPurchase.create({
        data: {
          userId,
          key,
          productId: product.id,
          price,
          catalogRevision: product.catalogRevision,
        },
      });
      await tx.avatarOwnership.create({
        data: { userId, productId: product.id, source: 'purchase' },
      });
      const currency = await tx.userCurrency.findUniqueOrThrow({
        where: { userId },
      });
      await tx.currencyTransaction.create({
        data: {
          userId,
          eventKey: `purchase:${key}`,
          kind: 'purchase',
          amount: -price,
          balanceAfter: currency.balance,
          purchaseId: purchase.id,
        },
      });
      return {
        replayed: false,
        purchase: this.purchaseView(purchase),
        ...(await this.state(tx, userId)),
      };
    });
  }

  private assertSale(product: AvatarProduct) {
    if (
      product.saleStatus !== 'on_sale' ||
      product.ownershipScope === 'pending' ||
      product.price === null
    )
      avatarError(409, 'NOT_FOR_SALE', '판매 중인 상품이 아닙니다.');
  }
  private purchaseView(purchase: {
    id: string;
    productId: string;
    price: number;
    catalogRevision: number;
    createdAt: Date;
  }) {
    return {
      id: purchase.id,
      productId: purchase.productId,
      price: purchase.price,
      catalogRevision: purchase.catalogRevision,
      createdAt: purchase.createdAt,
    };
  }

  // Server-internal only; no controller, automatic signup or workout reward.
  // Callers must validate a trusted event and derive the amount server-side.
  async grantCurrency(userId: string, eventKey: string, amount: number) {
    return this.database.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      return this.grantCurrencyInTransaction(tx, userId, eventKey, amount);
    });
  }

  // The caller locks multiple users in UUID order BEFORE calling this method.
  // FOR KEY SHARE protects deletion without conflicting with workout/purchase
  // NO KEY UPDATE owner locks. Currency rows are then credited in UUID order.
  async grantCurrencyInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    eventKey: string,
    amount: number,
  ) {
    if (
      !/^[a-z][a-z0-9._-]{0,49}:[A-Za-z0-9._:-]{1,140}$/.test(eventKey) ||
      eventKey.startsWith('purchase:') ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > 2147483647
    )
      avatarError(
        400,
        'INVALID_GRANT',
        '서버 지급 이벤트 형식을 확인해 주세요.',
      );
    const users = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR KEY SHARE`;
    if (!users.length)
      throw new UnauthorizedException('계정이 삭제되었습니다.');
    const previous = await tx.currencyTransaction.findUnique({
      where: { userId_eventKey: { userId, eventKey } },
    });
    if (previous) {
      if (previous.amount !== amount || previous.kind !== 'grant')
        avatarError(
          409,
          'GRANT_CONFLICT',
          '지급 이벤트가 기존 내용과 다릅니다.',
        );
      return {
        replayed: true,
        transaction: previous,
        ...(await this.state(tx, userId)),
      };
    }
    const credited = await tx.userCurrency.updateMany({
      where: { userId, balance: { lte: 2147483647 - amount } },
      data: { balance: { increment: amount } },
    });
    if (!credited.count) {
      if (!(await tx.userCurrency.findUnique({ where: { userId } })))
        avatarError(503, 'CURRENCY_MISSING', '재화 정보가 누락되었습니다.');
      avatarError(409, 'BALANCE_LIMIT', '잔액 한도를 초과합니다.');
    }
    const currency = await tx.userCurrency.findUniqueOrThrow({
      where: { userId },
    });
    const transaction = await tx.currencyTransaction.create({
      data: {
        userId,
        eventKey,
        amount,
        balanceAfter: currency.balance,
        kind: 'grant',
      },
    });
    return {
      replayed: false,
      transaction,
      ...(await this.state(tx, userId)),
    };
  }
}
