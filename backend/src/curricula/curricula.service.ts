import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { parseEntityId, invalidUserInput } from '../users/user-input.js';

export const includeAssignment = {
  curriculum: true,
} satisfies Prisma.UserCurriculumAssignmentInclude;
type Assignment = Prisma.UserCurriculumAssignmentGetPayload<{
  include: typeof includeAssignment;
}>;

export function serializeAssignment(row: Assignment) {
  return {
    id: row.id,
    status: row.status,
    assignedAt: row.assignedAt,
    completedAt: row.completedAt,
    curriculum: { id: row.curriculum.id, name: row.curriculum.name },
  };
}

// Internal state management only: the future caller supplies a trusted user ID
// and an existing definition. Neither reads nor completion invoke a recommender.
@Injectable()
export class CurriculaService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async assign(userId: string, curriculumId: string, requestKey: string) {
    userId = parseEntityId(userId);
    curriculumId = parseEntityId(curriculumId);
    requestKey = parseEntityId(requestKey);
    return this.database.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const previous = await tx.userCurriculumAssignment.findUnique({
        where: { userId_requestKey: { userId, requestKey } },
        include: includeAssignment,
      });
      if (previous) {
        if (previous.curriculumId !== curriculumId)
          throw new ConflictException(
            '배정 요청 키에 다른 커리큘럼을 사용할 수 없습니다.',
          );
        return serializeAssignment(previous);
      }
      const current = await tx.userCurriculumAssignment.findUnique({
        where: { currentForUserId: userId },
      });
      if (current && current.status !== 'completed')
        throw new ConflictException(
          '현재 운동을 완료한 뒤 다음 운동을 배정할 수 있습니다.',
        );
      if (
        !(await tx.workoutCurriculum.findUnique({
          where: { id: curriculumId },
        }))
      )
        throw new NotFoundException('커리큘럼 정의를 찾을 수 없습니다.');
      if (current)
        await tx.userCurriculumAssignment.update({
          where: { id: current.id },
          data: { currentForUserId: null },
        });
      const row = await tx.userCurriculumAssignment.create({
        data: { userId, curriculumId, requestKey, currentForUserId: userId },
        include: includeAssignment,
      });
      return serializeAssignment(row);
    });
  }

  async complete(userId: string, assignmentId: string) {
    userId = parseEntityId(userId);
    assignmentId = parseEntityId(assignmentId);
    return this.database.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const row = await tx.userCurriculumAssignment.findFirst({
        where: { id: assignmentId, userId },
        include: includeAssignment,
      });
      if (!row) throw new NotFoundException('배정 내역을 찾을 수 없습니다.');
      if (row.assignmentDate)
        throw new ConflictException(
          '일자별 운동은 운동 결과 API로 완료해 주세요.',
        );
      if (row.status === 'completed') return serializeAssignment(row);
      // DB clock sampled after the owner lock, never transaction start time.
      await tx.$executeRaw`
        UPDATE ${this.database.table('user_curriculum_assignments')} SET status = 'completed', completed_at = GREATEST(clock_timestamp(), assigned_at)
        WHERE id = ${assignmentId}::uuid AND user_id = ${userId}::uuid
      `;
      return serializeAssignment(
        await tx.userCurriculumAssignment.findFirstOrThrow({
          where: { id: assignmentId, userId },
          include: includeAssignment,
        }),
      );
    });
  }

  async current(userId: string) {
    const row = await this.database.userCurriculumAssignment.findUnique({
      where: { currentForUserId: parseEntityId(userId) },
      include: includeAssignment,
    });
    return row ? serializeAssignment(row) : null;
  }

  async history(userId: string, limit = 20, cursor?: string) {
    userId = parseEntityId(userId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      invalidUserInput([
        { field: 'limit', message: '1~50 범위의 정수를 사용해 주세요.' },
      ]);
    const boundary = cursor
      ? await this.database.userCurriculumAssignment.findFirst({
          where: { id: parseEntityId(cursor), userId },
        })
      : null;
    if (cursor && !boundary)
      throw new NotFoundException('배정 내역을 찾을 수 없습니다.');
    const rows = await this.database.userCurriculumAssignment.findMany({
      where: { userId },
      ...(boundary ? { cursor: { id: boundary.id }, skip: 1 } : {}),
      orderBy: [{ assignedAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      include: includeAssignment,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(serializeAssignment),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    const users = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!users.length)
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
  }
}
