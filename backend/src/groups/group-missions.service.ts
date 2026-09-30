import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AvatarService } from '../avatar/avatar.service.js';
import { DatabaseService } from '../database/database.service.js';
import { retryTransaction } from '../database/transaction-retry.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  GroupMissionRound,
  GroupRouletteDraw,
} from '../generated/prisma/client.js';
import {
  MISSION_POLICY_VERSION,
  missionStage,
  roulettePolicy,
  rouletteResult,
} from './mission-policy.js';

type Tx = Prisma.TransactionClient;
type Page = { limit: number; cursor?: string };
export const MISSION_CLOCK = Symbol('MISSION_CLOCK');
export const ROULETTE_RANDOM = Symbol('ROULETTE_RANDOM');

@Injectable()
export class GroupMissionsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AvatarService) private readonly avatar: AvatarService,
    @Optional() @Inject(MISSION_CLOCK) private readonly clock?: () => Date,
    @Optional() @Inject(ROULETTE_RANDOM) private readonly random?: () => number,
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
  private async now(tx: Tx) {
    if (this.clock) return this.clock();
    const [row] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    return row.now;
  }
  private async keyLock(
    tx: Tx,
    operation: string,
    userId: string,
    key: string,
  ) {
    // Per-request locks also serialize reuse of one key across different groups.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${operation}:${userId}:${key}`}, 0))::text`;
  }
  private async authorize(
    tx: Tx,
    userId: string,
    groupId: string,
    leader = false,
    read = false,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ${this.database.table('groups')} WHERE id = ${groupId}::uuid
      ${read ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}
    `;
    if (!rows.length) throw new NotFoundException('그룹을 찾을 수 없습니다.');
    const membership = await tx.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership)
      throw new ForbiddenException('그룹 구성원만 접근할 수 있습니다.');
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    if (leader && group.leaderUserId !== userId)
      throw new ForbiddenException('그룹장만 수행할 수 있습니다.');
    return group;
  }
  private async roundView(tx: Tx, round: GroupMissionRound, userId: string) {
    const participant = await tx.groupMissionParticipant.findFirst({
      where: { roundId: round.id, userId },
    });
    const eligible = !!participant && participant.invalidatedAt === null;
    const n = round.memberCount;
    return {
      id: round.id,
      groupId: round.groupId,
      status: round.completedAt ? 'completed' : 'in_progress',
      startedAt: round.startedAt,
      completedAt: round.completedAt,
      memberCount: n,
      stage: missionStage(round.waterCount, n),
      waterCount: round.waterCount,
      stageTargets: {
        seed: 0,
        sprout: n,
        stem: 3 * n,
        bud: 7 * n,
        sunflower: 14 * n,
      },
      totalTarget: round.totalTarget,
      policyVersion: round.policyVersion,
      me: {
        eligible,
        reason: !participant
          ? 'not_in_snapshot'
          : eligible
            ? 'eligible'
            : 'membership_ended',
        waterCount: participant?.waterCount ?? 0,
      },
    };
  }
  async start(userId: string, groupId: string, key: string) {
    return this.transaction(async (tx) => {
      await this.keyLock(tx, 'mission-start', userId, key);
      await this.authorize(tx, userId, groupId, true);
      const previous = await tx.groupMissionStartRequest.findUnique({
        where: { userId_key: { userId, key } },
        include: { round: true },
      });
      if (previous) {
        if (previous.round.groupId !== groupId)
          throw new ConflictException(
            '같은 요청 키에 다른 그룹을 사용할 수 없습니다.',
          );
        const participant = await tx.groupMissionParticipant.findFirst({
          where: { roundId: previous.roundId, userId, invalidatedAt: null },
        });
        if (!participant)
          throw new ForbiddenException(
            '기존 회차의 참여 자격이 종료되었습니다.',
          );
        return {
          mission: await this.roundView(tx, previous.round, userId),
          replayed: true,
        };
      }
      if (
        await tx.groupMissionRound.findFirst({
          where: { groupId, completedAt: null },
        })
      )
        throw new ConflictException('이미 진행 중인 미션이 있습니다.');
      // Protect the snapshot from account deletion, in deterministic user order.
      const members = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT u.id FROM ${this.database.table('users')} u
        JOIN ${this.database.table('group_memberships')} m ON m.user_id = u.id
        WHERE m.group_id = ${groupId}::uuid ORDER BY u.id FOR KEY SHARE OF u
      `;
      if (members.length < 2)
        throw new ConflictException(
          '미션 시작에는 그룹장 포함 최소 2명이 필요합니다.',
        );
      const round = await tx.groupMissionRound.create({
        data: {
          groupId,
          memberCount: members.length,
          totalTarget: 14 * members.length,
          startedAt: await this.now(tx),
          policyVersion: MISSION_POLICY_VERSION,
          roulettePolicy,
          participants: {
            create: members.map((member) => ({ userId: member.id })),
          },
          starts: { create: { userId, key } },
        },
      });
      return {
        mission: await this.roundView(tx, round, userId),
        replayed: false,
      };
    });
  }
  async current(userId: string, groupId: string) {
    return this.transaction(async (tx) => {
      await this.authorize(tx, userId, groupId, false, true);
      const round =
        (await tx.groupMissionRound.findFirst({
          where: { groupId, completedAt: null },
        })) ??
        (await tx.groupMissionRound.findFirst({
          where: { groupId },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        }));
      return round
        ? this.roundView(tx, round, userId)
        : { status: 'not_started', id: null };
    }, true);
  }
  async history(userId: string, groupId: string, page: Page) {
    return this.transaction(async (tx) => {
      await this.authorize(tx, userId, groupId, false, true);
      const rows = await tx.groupMissionRound.findMany({
        where: { groupId, ...(page.cursor ? { id: { gt: page.cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      return {
        items: await Promise.all(
          items.map((row) => this.roundView(tx, row, userId)),
        ),
        nextCursor: rows.length > page.limit ? items.at(-1)!.id : null,
      };
    }, true);
  }
  async tickets(userId: string, groupId: string, page: Page) {
    return this.transaction(async (tx) => {
      await this.authorize(tx, userId, groupId, false, true);
      const rows = await tx.groupRouletteTicket.findMany({
        where: {
          round: { groupId },
          participant: { userId },
          ...(page.cursor ? { id: { gt: page.cursor } } : {}),
        },
        include: { draw: true, participant: true, round: true },
        orderBy: { id: 'asc' },
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      return {
        items: items.map((ticket) => ({
          id: ticket.id,
          roundId: ticket.roundId,
          createdAt: ticket.createdAt,
          policyVersion: ticket.round.policyVersion,
          status: ticket.draw
            ? 'used'
            : ticket.invalidatedAt || ticket.participant.invalidatedAt
              ? 'invalidated'
              : 'available',
          usable:
            !ticket.draw &&
            !ticket.invalidatedAt &&
            !ticket.participant.invalidatedAt,
          usedAt: ticket.draw?.drawnAt ?? null,
          invalidatedAt:
            ticket.invalidatedAt ?? ticket.participant.invalidatedAt,
        })),
        nextCursor: rows.length > page.limit ? items.at(-1)!.id : null,
      };
    }, true);
  }
  private async drawView(tx: Tx, draw: GroupRouletteDraw, userId: string) {
    const rewards = await tx.groupRouletteReward.findMany({
      where: { drawId: draw.id },
      orderBy: { id: 'asc' },
    });
    const ticket = await tx.groupRouletteTicket.findUniqueOrThrow({
      where: { id: draw.ticketId },
    });
    return {
      id: draw.id,
      ticketId: draw.ticketId,
      roundId: ticket.roundId,
      drawnAt: draw.drawnAt,
      policyVersion: draw.policyVersion,
      result: draw.result,
      amountPerRecipient: draw.amount,
      recipients: rewards.map((reward) => ({
        userId: reward.userId,
        amount: reward.amount,
      })),
      myReward: rewards
        .filter((reward) => reward.userId === userId)
        .map((reward) => ({
          amount: reward.amount,
          transactionId: reward.transactionId,
        })),
    };
  }
  async spin(userId: string, groupId: string, ticketId: string, key: string) {
    return this.transaction(async (tx) => {
      await this.keyLock(tx, 'roulette-spin', userId, key);
      await this.authorize(tx, userId, groupId);
      const ticket = await tx.groupRouletteTicket.findFirst({
        where: { id: ticketId, round: { groupId }, participant: { userId } },
        include: { round: true, participant: true, draw: true },
      });
      if (!ticket)
        throw new NotFoundException('본인의 룰렛권을 찾을 수 없습니다.');
      if (ticket.invalidatedAt || ticket.participant.invalidatedAt)
        throw new ForbiddenException('룰렛권의 참여 자격이 종료되었습니다.');
      const previous = await tx.groupRouletteDraw.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (previous) {
        if (previous.ticketId !== ticketId)
          throw new ConflictException(
            '같은 요청 키에 다른 룰렛권을 사용할 수 없습니다.',
          );
        return {
          draw: await this.drawView(tx, previous, userId),
          replayed: true,
        };
      }
      if (ticket.draw) throw new ConflictException('이미 사용한 룰렛권입니다.');
      const result = rouletteResult(
        ticket.round.policyVersion,
        ticket.round.roulettePolicy,
        this.random ? this.random() : randomInt(100),
      );
      const participants = await tx.groupMissionParticipant.findMany({
        where: {
          roundId: ticket.roundId,
          userId: { not: null },
          invalidatedAt: null,
          waterCount: { gt: 0 },
          ...(result.audience === 'self' ? { id: ticket.participantId } : {}),
        },
      });
      const candidates = participants
        .map((participant) => participant.userId!)
        .sort();
      const recipients = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT u.id FROM ${this.database.table('users')} u
        JOIN ${this.database.table('group_memberships')} m ON m.user_id = u.id
        WHERE m.group_id = ${groupId}::uuid AND u.id IN (${Prisma.join(candidates.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY u.id FOR KEY SHARE OF u
      `;
      if (!recipients.some((recipient) => recipient.id === userId))
        throw new ForbiddenException('추첨 참여 자격이 종료되었습니다.');
      const draw = await tx.groupRouletteDraw.create({
        data: {
          ticketId,
          userId,
          key,
          policyVersion: ticket.round.policyVersion,
          result: result.result,
          amount: result.amount,
          drawnAt: await this.now(tx),
        },
      });
      // All recipients and currency rows are processed in UUID order. One grant
      // failure rolls back this draw, the ticket consumption and EVERY reward.
      for (const recipient of recipients) {
        const grant = await this.avatar.grantCurrencyInTransaction(
          tx,
          recipient.id,
          `group-roulette:${draw.id}`,
          result.amount,
        );
        await tx.groupRouletteReward.create({
          data: {
            drawId: draw.id,
            userId: recipient.id,
            amount: result.amount,
            transactionId: grant.transaction.id,
          },
        });
      }
      return { draw: await this.drawView(tx, draw, userId), replayed: false };
    });
  }
  async draws(userId: string, groupId: string, page: Page) {
    return this.transaction(async (tx) => {
      await this.authorize(tx, userId, groupId, false, true);
      const rows = await tx.groupRouletteDraw.findMany({
        where: {
          ticket: { round: { groupId } },
          OR: [{ userId }, { rewards: { some: { userId } } }],
          ...(page.cursor ? { id: { gt: page.cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      return {
        items: await Promise.all(
          items.map((draw) => this.drawView(tx, draw, userId)),
        ),
        nextCursor: rows.length > page.limit ? items.at(-1)!.id : null,
      };
    }, true);
  }
}
