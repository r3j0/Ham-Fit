import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { AvatarService } from '../avatar/avatar.service.js';
import { DatabaseService } from '../database/database.service.js';
import { retryTransaction } from '../database/transaction-retry.js';
import { Prisma } from '../generated/prisma/client.js';
import { streakResult, uniformProduct } from './streak-policy.js';

export type StreakPage = { limit: number; cursor?: string };
export const STREAK_CLOCK = Symbol('STREAK_CLOCK');
export const STREAK_RANDOM = Symbol('STREAK_RANDOM');
type Tx = Prisma.TransactionClient;
const ticketInclude = { draw: true } as const;
const drawInclude = { ticket: { include: { achievement: true } } } as const;
type Draw = Prisma.StreakRouletteDrawGetPayload<{
  include: typeof drawInclude;
}>;
type Ticket = Prisma.StreakRouletteTicketGetPayload<{
  include: typeof ticketInclude;
}>;

@Injectable()
export class StreakRouletteService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AvatarService) private readonly avatar: AvatarService,
    @Optional() @Inject(STREAK_CLOCK) private readonly clock?: () => Date,
    @Optional()
    @Inject(STREAK_RANDOM)
    private readonly random?: (max: number) => number,
  ) {}
  private transaction<T>(work: (tx: Tx) => Promise<T>, read = false) {
    return retryTransaction(() =>
      this.database.$transaction(work, {
        isolationLevel: read
          ? Prisma.TransactionIsolationLevel.RepeatableRead
          : Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15_000,
      }),
    );
  }
  private evidence(ticket: Draw['ticket']) {
    return {
      id: ticket.achievementId,
      koreanDate: ticket.koreanDate.toISOString().slice(0, 10),
      segmentStartDate: ticket.segmentStartDate.toISOString().slice(0, 10),
      streakDays: ticket.streakDays,
      achievedAt: ticket.achievement.achievedAt,
      sourceKind: ticket.achievement.sourceKind,
      sourceId: ticket.achievement.sourceId,
    };
  }
  private ticketView(ticket: Ticket) {
    return {
      id: ticket.id,
      achievementId: ticket.achievementId,
      koreanDate: ticket.koreanDate.toISOString().slice(0, 10),
      segmentStartDate: ticket.segmentStartDate.toISOString().slice(0, 10),
      streakDays: ticket.streakDays,
      createdAt: ticket.createdAt,
      policyVersion: ticket.policyVersion,
      status: ticket.draw ? 'used' : 'available',
      usable: !ticket.draw,
      usedAt: ticket.draw?.drawnAt ?? null,
    };
  }
  private drawView(draw: Draw) {
    return {
      id: draw.id,
      ticketId: draw.ticketId,
      achievement: this.evidence(draw.ticket),
      drawnAt: draw.drawnAt,
      policyVersion: draw.policyVersion,
      originalResult: draw.result,
      actualReward: {
        kind: draw.actualKind,
        amount: draw.amount,
        productId: draw.productId,
        transactionId: draw.transactionId,
      },
      fallback: {
        applied: draw.fallbackReason !== null,
        reason: draw.fallbackReason,
      },
    };
  }
  tickets(userId: string, page: StreakPage) {
    return this.transaction(async (tx) => {
      const rows = await tx.streakRouletteTicket.findMany({
        where: { userId, ...(page.cursor ? { id: { gt: page.cursor } } : {}) },
        include: ticketInclude,
        orderBy: { id: 'asc' },
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      return {
        items: items.map((ticket) => this.ticketView(ticket)),
        availableCount: await tx.streakRouletteTicket.count({
          where: { userId, draw: null },
        }),
        nextCursor: rows.length > page.limit ? items.at(-1)!.id : null,
      };
    }, true);
  }
  async spin(userId: string, ticketId: string, key: string) {
    return this.transaction(async (tx) => {
      // Same owner lock as completion/purchase/outfit. No group or global lock.
      const users = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR NO KEY UPDATE
      `;
      if (!users.length)
        throw new UnauthorizedException('계정이 삭제되었습니다.');
      const previous = await tx.streakRouletteDraw.findUnique({
        where: { userId_key: { userId, key } },
        include: drawInclude,
      });
      if (previous) {
        if (previous.ticketId !== ticketId)
          throw new ConflictException({
            statusCode: 409,
            code: 'IDEMPOTENCY_CONFLICT',
            message: '같은 요청 키에 다른 개인 룰렛권을 사용할 수 없습니다.',
          });
        return { draw: this.drawView(previous), replayed: true };
      }
      const ticket = await tx.streakRouletteTicket.findFirst({
        where: { id: ticketId, userId },
        include: { draw: true, policy: true },
      });
      if (!ticket)
        throw new NotFoundException('본인의 개인 룰렛권을 찾을 수 없습니다.');
      if (ticket.draw)
        throw new ConflictException({
          statusCode: 409,
          code: 'TICKET_USED',
          message: '이미 사용한 개인 룰렛권입니다.',
        });
      const result = streakResult(
        ticket.policyVersion,
        ticket.policy.snapshot,
        this.random ? this.random(1000) : randomInt(1000),
      );
      let productId: string | null = null;
      const itemKind =
        result.result === 'clothing' || result.result === 'pose'
          ? result.result
          : null;
      if (itemKind) {
        // FOR SHARE protects the entire eligible product pool against sale
        // updates/deletion, just like purchase. A waiting query rechecks status.
        // The owner lock protects inventory against other spins/purchases.
        const products = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT p.id FROM ${this.database.table('avatar_products')} p
          WHERE p.kind = ${itemKind} AND p.sale_status = 'on_sale'
            AND NOT EXISTS (SELECT 1 FROM ${this.database.table('avatar_ownerships')} o WHERE o.user_id = ${userId}::uuid AND o.product_id = p.id)
          ORDER BY p.id FOR SHARE OF p
        `;
        if (products.length)
          productId = uniformProduct(
            products,
            this.random
              ? this.random(products.length)
              : randomInt(products.length),
          ).id;
      }
      const [clock] = this.clock
        ? [{ now: this.clock() }]
        : await tx.$queryRaw<
            Array<{ now: Date }>
          >`SELECT clock_timestamp() AS now`;
      const id = randomUUID();
      const actualKind = productId ? itemKind! : 'seeds';
      const amount = productId ? 1 : result.amount;
      let transactionId: string | null = null;
      if (productId) {
        await tx.avatarOwnership.create({
          data: {
            userId,
            productId,
            source: 'streak_roulette',
            acquiredAt: clock.now,
          },
        });
      } else {
        const grant = await this.avatar.grantCurrencyInTransaction(
          tx,
          userId,
          `streak-roulette:${id}`,
          amount,
        );
        transactionId = grant.transaction.id;
      }
      const draw = await tx.streakRouletteDraw.create({
        data: {
          id,
          ticketId,
          userId,
          key,
          policyVersion: ticket.policyVersion,
          result: result.result,
          actualKind,
          amount,
          productId,
          transactionId,
          fallbackReason: itemKind && !productId ? 'no_eligible_product' : null,
          drawnAt: clock.now,
        },
        include: drawInclude,
      });
      return { draw: this.drawView(draw), replayed: false };
    });
  }
  draws(userId: string, page: StreakPage) {
    return this.transaction(async (tx) => {
      const rows = await tx.streakRouletteDraw.findMany({
        where: { userId, ...(page.cursor ? { id: { gt: page.cursor } } : {}) },
        include: drawInclude,
        orderBy: { id: 'asc' },
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      return {
        items: items.map((draw) => this.drawView(draw)),
        nextCursor: rows.length > page.limit ? items.at(-1)!.id : null,
      };
    }, true);
  }
}
