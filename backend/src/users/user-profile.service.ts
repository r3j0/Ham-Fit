import { memberProfiles } from './member-profile.js';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { birthProfile } from './date-of-birth.js';
import { parseProfileUpdate } from './user-profile-input.js';
import {
  includeAssignment,
  serializeAssignment,
} from '../curricula/curricula.service.js';

@Injectable()
export class UserProfileService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async activity(userId: string) {
    return this.database.$transaction(
      async (tx) => {
        const profile = (await memberProfiles(tx, [userId])).get(userId);
        if (!profile) throw new UnauthorizedException('계정이 삭제되었습니다.');
        return profile;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async profile(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { dateOfBirth: true, nickname: true },
    });
    if (!user)
      throw new UnauthorizedException(
        '로그인이 필요하거나 계정이 삭제되었습니다.',
      );
    return { ...birthProfile(user.dateOfBirth), nickname: user.nickname };
  }

  async updateProfile(userId: string, value: unknown) {
    const input = parseProfileUpdate(value);
    const data: Prisma.UserUpdateInput = {};
    if (input.dateOfBirth !== undefined)
      data.dateOfBirth = new Date(`${input.dateOfBirth}T00:00:00.000Z`);
    if (input.nickname !== undefined) data.nickname = input.nickname;
    return this.database.$transaction(async (tx) => {
      const users = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!users.length)
        throw new UnauthorizedException(
          '로그인이 필요하거나 계정이 삭제되었습니다.',
        );
      const user = await tx.user.update({
        where: { id: userId },
        data,
        select: { dateOfBirth: true, nickname: true },
      });
      return { ...birthProfile(user.dateOfBirth), nickname: user.nickname };
    });
  }

  async get(userId: string) {
    // Read account state and measurement existence in one snapshot. Only an ID
    // is needed for onboarding; no measured values or goals are loaded.
    return this.database.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
            dateOfBirth: true,
            nickname: true,
          },
        });
        if (!user)
          throw new UnauthorizedException(
            '로그인이 필요하거나 계정이 삭제되었습니다.',
          );
        // Keep one Repeatable Read snapshot while avoiding Prisma's concurrent
        // sibling relation reads on the transaction's single pg connection.
        const currency = await tx.userCurrency.findUnique({
          where: { userId },
          select: { balance: true },
        });
        if (!currency)
          throw new ServiceUnavailableException(
            '사용자 재화 정보가 누락되었습니다. 관리자 확인이 필요합니다.',
          );
        const currentCurriculumAssignment =
          await tx.userCurriculumAssignment.findUnique({
            where: { currentForUserId: userId },
            include: includeAssignment,
          });
        const measurement = await tx.measurement.findFirst({
          where: { userId },
          select: { id: true },
        });
        return {
          id: user.id,
          email: user.email,
          created_at: user.createdAt,
          updated_at: user.updatedAt,
          ...birthProfile(user.dateOfBirth),
          nickname: user.nickname,
          isOnboarded: measurement !== null,
          currency: { balance: currency.balance },
          currentCurriculum: currentCurriculumAssignment
            ? serializeAssignment(currentCurriculumAssignment)
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
