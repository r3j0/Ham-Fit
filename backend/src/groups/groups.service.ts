import { retryTransaction } from '../database/transaction-retry.js';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Group, GroupJoinRequest } from '../generated/prisma/client.js';
import { memberProfiles } from '../users/member-profile.js';

type Tx = Prisma.TransactionClient;
type Page = { limit: number; cursor?: string };
const summarySelect = {
  id: true,
  name: true,
  description: true,
  maxMembers: true,
  leaderUserId: true,
  createdAt: true,
  _count: { select: { members: true } },
} satisfies Prisma.GroupSelect;
type Summary = Prisma.GroupGetPayload<{ select: typeof summarySelect }>;
const summary = (group: Summary) => ({
  id: group.id,
  name: group.name,
  description: group.description,
  maxMembers: group.maxMembers,
  currentMembers: group._count.members,
  createdAt: group.createdAt,
});
const application = (row: GroupJoinRequest) => ({
  id: row.id,
  groupId: row.groupId,
  userId: row.userId,
  status: row.status,
  createdAt: row.createdAt,
  processedAt: row.processedAt,
});
const role = (group: Pick<Group, 'leaderUserId'>, userId: string) =>
  group.leaderUserId === userId ? 'leader' : 'member';

@Injectable()
export class GroupsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // PostgreSQL can resolve FK/account-deletion lock cycles by aborting a transaction.
  // Retry the entire unit, including notifications; never retry only the last write.
  private async transaction<T>(
    work: (tx: Tx) => Promise<T>,
    snapshot = false,
  ): Promise<T> {
    return retryTransaction(() =>
      this.database.$transaction(work, {
        isolationLevel: snapshot
          ? Prisma.TransactionIsolationLevel.RepeatableRead
          : Prisma.TransactionIsolationLevel.ReadCommitted,
      }),
    );
  }
  private async lockUser(tx: Tx, userId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    if (!rows.length) throw new UnauthorizedException('계정이 삭제되었습니다.');
  }
  private async protectTargetAccount(tx: Tx, userId: string) {
    // Group locks do not prevent users' ON DELETE CASCADE operations. Hold a
    // key-share lock until commit so admission/leadership cannot target a user
    // deleted between the membership read and the FK write.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR KEY SHARE
    `;
    if (!rows.length)
      throw new NotFoundException('대상 계정이 삭제되었습니다.');
  }
  private async lockGroup(tx: Tx, groupId: string, read = false) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM ${this.database.table('groups')} WHERE id = ${groupId}::uuid ${read ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}`;
    if (!rows.length) throw new NotFoundException('그룹을 찾을 수 없습니다.');
    return tx.group.findUniqueOrThrow({
      where: { id: groupId },
      select: summarySelect,
    });
  }
  private async authorize(
    tx: Tx,
    group: Summary,
    userId: string,
    leader = false,
  ) {
    if (
      !(await tx.groupMembership.findUnique({
        where: { groupId_userId: { groupId: group.id, userId } },
      }))
    )
      throw new ForbiddenException('그룹 구성원만 접근할 수 있습니다.');
    if (leader && group.leaderUserId !== userId)
      throw new ForbiddenException('그룹장만 수행할 수 있습니다.');
  }
  private async memberGroup(
    tx: Tx,
    groupId: string,
    userId: string,
    leader = false,
    read = false,
  ) {
    const group = await this.lockGroup(tx, groupId, read);
    await this.authorize(tx, group, userId, leader);
    return group;
  }

  async create(
    userId: string,
    key: string,
    input: { name: string; description: string; maxMembers: number },
  ) {
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return this.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const prior = await tx.groupCreateRequest.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (prior) {
        if (prior.requestHash !== hash)
          throw new ConflictException(
            '요청 키에 다른 생성 정보를 사용할 수 없습니다.',
          );
        const group = await this.memberGroup(tx, prior.groupId, userId);
        return { ...summary(group), role: role(group, userId) };
      }
      const group = await tx.group.create({
        data: {
          ...input,
          leaderUserId: userId,
          inviteCode: randomBytes(32).toString('base64url'),
          members: { create: { userId } },
        },
        select: summarySelect,
      });
      await tx.groupCreateRequest.create({
        data: { userId, key, requestHash: hash, groupId: group.id },
      });
      return { ...summary(group), role: 'leader' };
    });
  }
  async list(userId: string, page: Page) {
    const rows = await this.database.group.findMany({
      where: {
        members: { some: { userId } },
        ...(page.cursor ? { id: { gt: page.cursor } } : {}),
      },
      select: summarySelect,
      orderBy: { id: 'asc' },
      take: page.limit + 1,
    });
    const items = rows.slice(0, page.limit);
    return {
      items: items.map((row) => ({ ...summary(row), role: role(row, userId) })),
      nextCursor: rows.length > page.limit ? items.at(-1)!.id : null,
    };
  }
  async detail(userId: string, groupId: string, memberId?: string) {
    return this.transaction(async (tx) => {
      const group = await this.memberGroup(tx, groupId, userId, false, true);
      const members = await tx.groupMembership.findMany({
        where: { groupId, ...(memberId ? { userId: memberId } : {}) },
        orderBy: { userId: 'asc' },
      });
      if (memberId && !members.length)
        throw new NotFoundException('그룹원을 찾을 수 없습니다.');
      const profiles = await memberProfiles(
        tx,
        members.map((member) => member.userId),
      );
      // Match missions/current: prefer the active round, otherwise the latest
      // completed round. Invalidated participation never returns after rejoining.
      const missionSelect = {
        id: true,
        participants: {
          where: {
            userId: { in: members.map((member) => member.userId) },
            invalidatedAt: null,
          },
          select: { userId: true, waterCount: true },
        },
      } satisfies Prisma.GroupMissionRoundSelect;
      const round =
        (await tx.groupMissionRound.findFirst({
          where: { groupId, completedAt: null },
          select: missionSelect,
        })) ??
        (await tx.groupMissionRound.findFirst({
          where: { groupId },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          select: missionSelect,
        }));
      const contributions = new Map(
        round?.participants.map((participant) => [
          participant.userId,
          { roundId: round.id, waterCount: participant.waterCount },
        ]),
      );
      const views = members.map((member) => ({
        ...profiles.get(member.userId)!,
        role: role(group, member.userId),
        joinedAt: member.joinedAt,
        missionContribution: contributions.get(member.userId) ?? null,
      }));
      return memberId ? views[0] : { ...summary(group), members: views };
    }, true);
  }
  async overview(userId: string) {
    return this.transaction(async (tx) => {
      const missionSelect = {
        id: true,
        groupId: true,
        participants: {
          where: { invalidatedAt: null },
          select: { userId: true, waterCount: true },
        },
      } satisfies Prisma.GroupMissionRoundSelect;
      const groups = await tx.group.findMany({
        where: { members: { some: { userId } } },
        orderBy: { id: 'asc' },
        select: {
          ...summarySelect,
          members: { orderBy: { userId: 'asc' } },
          missions: {
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: missionSelect,
          },
        },
      });
      if (!groups.length) return { items: [] };
      // Load shared members once, rather than repeating avatar/history queries
      // for every group. All reads use the same membership snapshot.
      const userIds = [
        ...new Set(groups.flatMap((g) => g.members.map((m) => m.userId))),
      ];
      const profiles = await memberProfiles(tx, userIds);
      const activeRounds = await tx.groupMissionRound.findMany({
        where: { groupId: { in: groups.map((g) => g.id) }, completedAt: null },
        select: missionSelect,
      });
      const active = new Map(
        activeRounds.map((round) => [round.groupId, round]),
      );
      return {
        items: groups.map((group) => {
          const round = active.get(group.id) ?? group.missions[0];
          const contributions = new Map(
            round?.participants.map((p) => [
              p.userId,
              { roundId: round.id, waterCount: p.waterCount },
            ]),
          );
          return {
            ...summary(group),
            role: role(group, userId),
            members: group.members.map((member) => ({
              ...profiles.get(member.userId)!,
              role: role(group, member.userId),
              joinedAt: member.joinedAt,
              missionContribution: contributions.get(member.userId) ?? null,
            })),
          };
        }),
      };
    }, true);
  }
  async inviteCode(userId: string, groupId: string) {
    return this.transaction(async (tx) => {
      await this.memberGroup(tx, groupId, userId, false, true);
      return tx.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { inviteCode: true },
      });
    }, true);
  }
  async update(
    userId: string,
    groupId: string,
    input: { name?: string; description?: string },
  ) {
    return this.transaction(async (tx) => {
      await this.memberGroup(tx, groupId, userId, true);
      return summary(
        await tx.group.update({
          where: { id: groupId },
          data: input,
          select: summarySelect,
        }),
      );
    });
  }
  async apply(userId: string, key: string, inviteCode: string) {
    return this.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      // No code is copied to a request, notification, general response or log.
      const found = await tx.group.findUnique({
        where: { inviteCode },
        select: { id: true },
      });
      if (!found)
        throw new NotFoundException('유효한 초대 코드를 찾을 수 없습니다.');
      const group = await this.lockGroup(tx, found.id);
      const prior = await tx.groupJoinRequest.findUnique({
        where: { userId_requestKey: { userId, requestKey: key } },
      });
      if (prior) {
        if (prior.groupId !== group.id)
          throw new ConflictException(
            '요청 키에 다른 그룹을 사용할 수 없습니다.',
          );
        return application(prior);
      }
      if (
        await tx.groupMembership.findUnique({
          where: { groupId_userId: { groupId: group.id, userId } },
        })
      )
        throw new ConflictException('이미 그룹 구성원입니다.');
      if (
        await tx.groupJoinRequest.findFirst({
          where: { groupId: group.id, userId, status: 'pending' },
        })
      )
        throw new ConflictException('대기 중인 가입 신청이 있습니다.');
      const row = await tx.groupJoinRequest.create({
        data: { groupId: group.id, userId, requestKey: key },
      });
      await tx.groupNotification.create({
        data: {
          userId: group.leaderUserId,
          groupId: group.id,
          requestId: row.id,
          type: 'join_requested',
        },
      });
      return application(row);
    });
  }
  async applications(
    userId: string,
    groupId: string,
    page: Page & { status: string },
  ) {
    return this.transaction(async (tx) => {
      await this.memberGroup(tx, groupId, userId, true, true);
      const rows = await tx.groupJoinRequest.findMany({
        where: {
          groupId,
          status: page.status,
          ...(page.cursor ? { id: { gt: page.cursor } } : {}),
        },
        include: { user: { select: { nickname: true } } },
        orderBy: { id: 'asc' },
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      return {
        items: items.map((row) => ({
          ...application(row),
          nickname: row.user.nickname,
        })),
        nextCursor: rows.length > page.limit ? items.at(-1)!.id : null,
      };
    }, true);
  }
  async decide(
    userId: string,
    groupId: string,
    requestId: string,
    status: 'approved' | 'rejected',
  ) {
    return this.transaction(async (tx) => {
      const group = await this.memberGroup(tx, groupId, userId, true);
      const row = await tx.groupJoinRequest.findFirst({
        where: { id: requestId, groupId },
      });
      if (!row) throw new NotFoundException('가입 신청을 찾을 수 없습니다.');
      await this.protectTargetAccount(tx, row.userId);
      if (row.status !== 'pending') {
        if (row.status !== status)
          throw new ConflictException('이미 다른 결과로 처리된 신청입니다.');
        return application(row);
      }
      if (status === 'approved') {
        if (group._count.members >= group.maxMembers)
          throw new ConflictException('그룹 정원이 가득 찼습니다.');
        await tx.groupMembership.create({
          data: { groupId, userId: row.userId },
        });
      }
      const updated = await tx.groupJoinRequest.update({
        where: { id: requestId },
        data: { status, processedAt: new Date() },
      });
      await tx.groupNotification.create({
        data: {
          userId: row.userId,
          groupId,
          requestId,
          type: status === 'approved' ? 'join_approved' : 'join_rejected',
        },
      });
      return application(updated);
    });
  }
  async transfer(userId: string, groupId: string, targetId: string) {
    return this.transaction(async (tx) => {
      const group = await this.memberGroup(tx, groupId, userId, true);
      if (targetId === userId)
        throw new ConflictException('현재 일반 그룹원에게 위임해 주세요.');
      await this.protectTargetAccount(tx, targetId);
      if (
        !(await tx.groupMembership.findUnique({
          where: { groupId_userId: { groupId, userId: targetId } },
        }))
      )
        throw new NotFoundException('그룹원을 찾을 수 없습니다.');
      await tx.group.update({
        where: { id: group.id },
        data: { leaderUserId: targetId },
      });
    });
  }
  async kick(userId: string, groupId: string, targetId: string) {
    return this.transaction(async (tx) => {
      const group = await this.memberGroup(tx, groupId, userId, true);
      if (targetId === group.leaderUserId)
        throw new ConflictException('그룹장을 퇴출할 수 없습니다.');
      await tx.groupMembership.deleteMany({
        where: { groupId, userId: targetId },
      });
    });
  }
  async leave(userId: string, groupId: string) {
    return this.transaction(async (tx) => {
      const group = await this.memberGroup(tx, groupId, userId);
      if (group.leaderUserId === userId) {
        if (group._count.members > 1)
          throw new ConflictException('그룹장 권한을 위임한 뒤 탈퇴해 주세요.');
        await tx.group.delete({ where: { id: groupId } });
      } else
        // Concurrent account deletion may already have cascaded this membership.
        await tx.groupMembership.deleteMany({ where: { groupId, userId } });
    });
  }
  async delete(userId: string, groupId: string) {
    return this.transaction(async (tx) => {
      await this.memberGroup(tx, groupId, userId, true);
      await tx.group.delete({ where: { id: groupId } });
    });
  }
}
