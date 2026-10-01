import { historyBounds } from './history-query.js';
import type { HistoryRange } from './history-query.js';
import { recordActivityAchievement } from '../groups/mission-contributions.js';
import { retryTransaction } from '../database/transaction-retry.js';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  includeRecord,
  serializeRecord,
} from '../measurements/measurements.service.js';
import { ageOnDate, koreaDate } from '../users/date-of-birth.js';
import type {
  FactorVector,
  RecommendationVideo,
  WorkoutLog,
} from './workout-contracts.js';
import { WorkoutAlgorithm } from './workout-algorithm.js';
import { mediaFor } from './media.js';
import {
  nextPlaybackStatus,
  normalizePlaybackProgress,
  playbackInvalid,
  unionIntervals,
  watchedSeconds,
  workoutConflict,
} from './playback.js';
import type { PlaybackEventInput, PlaybackInterval } from './playback.js';

export const WORKOUT_CLOCK = Symbol('WORKOUT_CLOCK');
export const includeWorkout = {
  curriculum: {
    include: {
      video: { include: { catalog: { select: { sourceCommit: true } } } },
    },
  },
} satisfies Prisma.UserCurriculumAssignmentInclude;
type Assignment = Prisma.UserCurriculumAssignmentGetPayload<{
  include: typeof includeWorkout;
}>;
const videoInput = (
  video: Omit<NonNullable<Assignment['curriculum']['video']>, 'catalog'>,
): RecommendationVideo => ({
  videoId: video.videoId,
  title: video.title,
  originalUrl: video.originalUrl,
  ageGroup: video.ageGroup,
  equipment: video.equipment,
  durationSeconds: video.durationSeconds,
  fitnessWeights: video.fitnessWeights as FactorVector,
});
function readiness(code: string, message: string): never {
  throw new ConflictException({ statusCode: 409, code, message });
}
function unavailable(message: string): never {
  throw new ServiceUnavailableException({
    statusCode: 503,
    code: 'WORKOUT_CATALOG_UNAVAILABLE',
    message,
  });
}

@Injectable()
export class RecommendationsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkoutAlgorithm) private readonly algorithm: WorkoutAlgorithm,
    @Optional() @Inject(WORKOUT_CLOCK) private readonly clock?: () => Date,
  ) {}

  private async now(tx: Prisma.TransactionClient) {
    if (this.clock) return this.clock();
    const [result] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    return result.now;
  }

  private async locked<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient, now: Date) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await retryTransaction(() =>
          this.database.$transaction(
            async (tx) => {
              const users = await tx.$queryRaw<
                Array<{ id: string }>
              >`SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
              if (!users.length)
                throw new NotFoundException('사용자를 찾을 수 없습니다.');
              return work(tx, await this.now(tx));
            },
            {
              // The waiter must see a committed same-day assignment before calculation.
              isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
              timeout: 15000,
            },
          ),
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt < 4
        )
          continue;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(error.code)
        )
          workoutConflict(
            '동시에 처리 중인 요청이 있습니다. 같은 요청 키로 다시 시도해 주세요.',
          );
        throw error;
      }
    }
  }

  async today(userId: string, key: string) {
    return this.locked(userId, async (tx, now) => {
      // Replay precedes calculation, including cross-midnight retries.
      const request = await tx.workoutAssignmentRequest.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (request)
        return {
          assignment: await this.readResponse(
            tx,
            userId,
            request.assignmentId,
            now,
          ),
          replayed: true,
        };
      const oldKey = await tx.userCurriculumAssignment.findUnique({
        where: { userId_requestKey: { userId, requestKey: key } },
      });
      if (oldKey && !oldKey.assignmentDate)
        workoutConflict(
          '기존 커리큘럼 요청에 사용한 키입니다. 새로운 요청 키를 사용해 주세요.',
        );
      const day = koreaDate(now);
      const assignmentDate = new Date(`${day}T00:00:00Z`);
      const saved = await tx.userCurriculumAssignment.findUnique({
        where: { userId_assignmentDate: { userId, assignmentDate } },
      });
      if (saved) {
        await tx.workoutAssignmentRequest.create({
          data: { userId, key, assignmentId: saved.id },
        });
        return {
          assignment: await this.readResponse(tx, userId, saved.id, now),
          replayed: true,
        };
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.dateOfBirth)
        readiness(
          'DATE_OF_BIRTH_REQUIRED',
          '운동 추천을 위해 생년월일을 입력해 주세요.',
        );
      const age = ageOnDate(user.dateOfBirth.toISOString().slice(0, 10), day);
      if (age < 13 || age > 64)
        readiness(
          'AGE_UNSUPPORTED',
          '운동 추천은 현재 만 13~64세를 지원합니다.',
        );
      // Lock the selected record before reading its immutable-for-this-revision
      // item snapshot. Measurement update/delete takes the same parent lock.
      // A new record inserted afterwards belongs to the next selection.
      const [selectedMeasurement] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ${this.database.table('measurements')}
        WHERE user_id = ${userId}::uuid
        ORDER BY measured_on DESC, created_at DESC, id ASC
        LIMIT 1 FOR SHARE
      `;
      if (!selectedMeasurement)
        readiness(
          'MEASUREMENT_REQUIRED',
          '측정 기록을 한 건 이상 저장해 주세요.',
        );
      const measurement = await tx.measurement.findUniqueOrThrow({
        where: { id: selectedMeasurement.id },
        include: includeRecord,
      });
      const active = await tx.workoutCatalogActivation.findUnique({
        where: { id: 'current' },
        include: {
          catalog: { include: { videos: { orderBy: { videoId: 'asc' } } } },
        },
      });
      if (!active)
        unavailable('검증된 운동 영상 카탈로그가 아직 활성화되지 않았습니다.');
      const videos = active.catalog.videos.map(videoInput);
      const logs = await this.logs(tx, userId, now);
      const decision = await this.algorithm.recommend({
        age,
        measurement: serializeRecord(measurement),
        logs,
        referenceInstant: now.toISOString(),
        videos,
      });
      const curriculum = await tx.workoutCurriculum.findUnique({
        where: {
          catalogVersion_videoId: {
            catalogVersion: active.catalogVersion,
            videoId: decision.videoId,
          },
        },
      });
      if (!curriculum)
        unavailable('운동 영상의 커리큘럼 정의가 누락되었습니다.');
      const current = await tx.userCurriculumAssignment.findUnique({
        where: { currentForUserId: userId },
      });
      if (current)
        await tx.userCurriculumAssignment.update({
          where: { id: current.id },
          data: { currentForUserId: null, supersededAt: now },
        });
      const created = await tx.userCurriculumAssignment.create({
        data: {
          userId,
          curriculumId: curriculum.id,
          requestKey: key,
          currentForUserId: userId,
          assignmentDate,
          assignedAt: now,
          algorithmVersion: decision.algorithmVersion,
          inputSnapshot: {
            ...decision.snapshot,
            measurementId: measurement.id,
            measurementRevision: measurement.revision,
            measuredOn: measurement.measuredOn.toISOString().slice(0, 10),
            measurementCatalogVersion: measurement.catalogVersion,
            currentAge: age,
            dateOfBirth: user.dateOfBirth.toISOString().slice(0, 10),
            referenceDate: day,
            referenceInstant: now.toISOString(),
            algorithmVersion: decision.algorithmVersion,
            catalogVersion: active.catalogVersion,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.workoutAssignmentRequest.create({
        data: { userId, key, assignmentId: created.id },
      });
      return {
        assignment: await this.readResponse(tx, userId, created.id, now),
        replayed: false,
      };
    });
  }

  async current(userId: string) {
    return this.database.$transaction(
      async (tx) => {
        const now = await this.now(tx);
        const row = await tx.userCurriculumAssignment.findFirst({
          where: { currentForUserId: userId, assignmentDate: { not: null } },
          include: includeWorkout,
        });
        return row ? this.response(tx, row, now) : null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async get(userId: string, id: string) {
    return this.database.$transaction(
      async (tx) => this.readResponse(tx, userId, id, await this.now(tx)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async history(
    userId: string,
    limit = 20,
    cursor?: string,
    range?: HistoryRange,
  ) {
    return this.database.$transaction(
      async (tx) => {
        const now = await this.now(tx);
        if (
          cursor &&
          !(await tx.userCurriculumAssignment.findFirst({
            where: { id: cursor, userId, assignmentDate: { not: null } },
          }))
        )
          throw new NotFoundException('배정 내역을 찾을 수 없습니다.');
        const rows = await tx.userCurriculumAssignment.findMany({
          where: {
            userId,
            assignmentDate: { not: null },
            ...(range
              ? {
                  OR: [
                    { assignmentDate: historyBounds(range).assignmentDate },
                    { completedAt: historyBounds(range).completedAt },
                  ],
                }
              : {}),
          },
          orderBy: [{ assignedAt: 'desc' }, { id: 'asc' }],
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take: limit + 1,
          include: includeWorkout,
        });
        const page = rows.slice(0, limit);
        return {
          serverKoreanDate: koreaDate(now),
          items: await Promise.all(
            page.map((row) => this.response(tx, row, now)),
          ),
          nextCursor: rows.length > limit ? page.at(-1)!.id : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async event(
    userId: string,
    id: string,
    key: string,
    input: PlaybackEventInput,
  ) {
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return this.locked(userId, async (tx, now) => {
      const row = await this.owned(tx, userId, id);
      const previous = await tx.workoutProgressEvent.findUnique({
        where: { assignmentId_key: { assignmentId: id, key } },
      });
      if (previous) {
        if (previous.requestHash !== hash)
          workoutConflict(
            '같은 요청 키로 다른 재생 이벤트를 저장할 수 없습니다.',
          );
        return {
          assignment: await this.response(tx, row, now),
          replayed: true,
        };
      }
      if (input.occurredAt && new Date(input.occurredAt) > now)
        playbackInvalid('서버 시각 이후의 수행 시각을 입력할 수 없습니다.');
      const latest = await tx.workoutProgressEvent.findFirst({
        where: { assignmentId: id, deviceId: input.deviceId },
        orderBy: { sequence: 'desc' },
      });
      if (latest && input.sequence <= latest.sequence)
        workoutConflict(
          '이 기기의 이전 재생 이벤트입니다. 저장된 진행 상태를 다시 조회해 주세요.',
        );
      const video = row.curriculum.video!;
      const media = mediaFor(
        video.videoId,
        video.originalUrl,
        video.durationSeconds,
        video.catalog.sourceCommit,
      );
      const acceptedDurationSeconds =
        media.playbackStatus === 'verified'
          ? Math.max(video.durationSeconds, media.verifiedDurationSeconds!)
          : video.durationSeconds;
      const normalized = normalizePlaybackProgress(
        input,
        video.durationSeconds,
        acceptedDurationSeconds,
      );
      const intervals = unionIntervals(
        [...(row.intervals as PlaybackInterval[]), ...normalized.intervals],
        video.durationSeconds,
      );
      const status = nextPlaybackStatus(
        row.status,
        input.type,
        watchedSeconds(intervals),
        video.durationSeconds,
      );
      // A fresh duplicate completion is a harmless acknowledgement, never a second outcome.
      const completedReplay = row.status === 'completed';
      const final = ['not_performed', 'interrupted', 'completed'].includes(
        status,
      );
      if (!completedReplay && status === 'completed' && row.assignmentDate)
        await recordActivityAchievement(
          this.database,
          tx,
          userId,
          now,
          'daily_assignment',
          id,
        );
      const updated = completedReplay
        ? row
        : await tx.userCurriculumAssignment.update({
            where: { id },
            data: {
              status,
              intervals: intervals as Prisma.InputJsonValue,
              positionSeconds: normalized.positionSeconds,
              revision: { increment: 1 },
              ...(final ? { resultStatus: status, performedAt: now } : {}),
              ...(status === 'completed' ? { completedAt: now } : {}),
            },
            include: includeWorkout,
          });
      await tx.workoutProgressEvent.create({
        data: {
          assignmentId: id,
          key,
          requestHash: hash,
          deviceId: input.deviceId,
          sequence: input.sequence,
          type: input.type,
          intervals: input.intervals as Prisma.InputJsonValue,
          positionSeconds: input.positionSeconds,
          clientOccurredAt: input.occurredAt
            ? new Date(input.occurredAt)
            : null,
          receivedAt: now,
          resultingRevision: updated.revision,
        },
      });
      return {
        assignment: await this.response(tx, updated, now),
        replayed: completedReplay,
      };
    });
  }

  async getMedia(userId: string, id: string) {
    const row = await this.owned(this.database, userId, id);
    const video = row.curriculum.video!;
    return {
      videoId: video.videoId,
      catalogVersion: video.catalogVersion,
      originalUrl: video.originalUrl,
      durationSeconds: video.durationSeconds,
    };
  }

  private async owned(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    const row = await tx.userCurriculumAssignment.findFirst({
      where: { id, userId, assignmentDate: { not: null } },
      include: includeWorkout,
    });
    if (!row || !row.curriculum.video)
      throw new NotFoundException('배정 내역을 찾을 수 없습니다.');
    return row;
  }
  private async readResponse(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
    now: Date,
  ) {
    return this.response(tx, await this.owned(tx, userId, id), now);
  }
  private async logs(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ): Promise<WorkoutLog[]> {
    // ALL past representative outcomes, never event rows or a 14-day history slice.
    const rows = await tx.userCurriculumAssignment.findMany({
      where: {
        userId,
        resultStatus: { in: ['interrupted', 'completed'] },
        performedAt: { lte: now },
        assignmentDate: { not: null },
      },
      include: includeWorkout,
    });
    return rows.flatMap((row) =>
      row.curriculum.video && row.performedAt
        ? [
            {
              videoId: row.curriculum.video.videoId,
              date: row.performedAt.toISOString(),
              completed: row.resultStatus === 'completed',
              fitnessWeights: row.curriculum.video
                .fitnessWeights as FactorVector,
            },
          ]
        : [],
    );
  }
  private async response(
    tx: Prisma.TransactionClient,
    row: Assignment,
    now: Date,
  ) {
    const video = row.curriculum.video!;
    const intervals = row.intervals as PlaybackInterval[];
    const watched = watchedSeconds(intervals);
    const logs = await this.logs(tx, row.userId, now);
    return {
      id: row.id,
      koreanDate: row.assignmentDate!.toISOString().slice(0, 10),
      serverKoreanDate: koreaDate(now),
      status: row.status,
      revision: row.revision,
      assignedAt: row.assignedAt,
      completedAt: row.completedAt,
      performedAt: row.performedAt,
      resultStatus: row.resultStatus,
      video: {
        id: video.videoId,
        title: video.title,
        originalUrl: video.originalUrl,
        durationSeconds: video.durationSeconds,
        equipment: video.equipment,
        ageGroup: video.ageGroup,
        catalogVersion: video.catalogVersion,
        fitnessWeights: video.fitnessWeights,
        ...mediaFor(
          video.videoId,
          video.originalUrl,
          video.durationSeconds,
          video.catalog.sourceCommit,
        ),
      },
      progress: {
        durationSeconds: video.durationSeconds,
        watchedSeconds: watched,
        positionSeconds: row.positionSeconds,
        intervals,
        ratio: watched / video.durationSeconds,
      },
      algorithmVersion: row.algorithmVersion,
      inputSnapshot: row.inputSnapshot,
      weightAdjustment: await this.algorithm.weightAdjustment({
        videos: [videoInput(video)],
        logs,
        referenceInstant: now.toISOString(),
      }),
    };
  }
}
