import { historyBounds } from './history-query.js';
import type { HistoryRange } from './history-query.js';
import { recordRoutineReward } from '../users/activity-rewards.service.js';
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
import { mediaFor } from './media.js';
import {
  nextRoutinePlaybackStatus,
  normalizePlaybackProgress,
  playbackInvalid,
  unionIntervals,
  watchedSeconds,
  workoutConflict,
} from './playback.js';
import type { PlaybackEventInput, PlaybackInterval } from './playback.js';
import {
  RoutineAlgorithm,
  parseRoutineDecision,
  routineInput,
} from './routine-algorithm.js';
import { WORKOUT_CLOCK } from './recommendations.service.js';

const includeRoutine = {
  items: { orderBy: { order: 'asc' as const } },
} satisfies Prisma.WorkoutRoutineInclude;
type Routine = Prisma.WorkoutRoutineGetPayload<{
  include: typeof includeRoutine;
}>;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
function recordingWindow(assignmentDate: Date, now: Date) {
  const day = dateOnly(assignmentDate);
  const serverKoreanDate = koreaDate(now);
  return {
    serverTime: now.toISOString(),
    serverKoreanDate,
    recordingAllowed: day === serverKoreanDate,
    recordingExpiresAt: new Date(
      new Date(`${day}T00:00:00+09:00`).getTime() + 86_400_000,
    ).toISOString(),
  };
}
function readiness(code: string, message: string): never {
  throw new ConflictException({ statusCode: 409, code, message });
}

@Injectable()
export class WorkoutRoutinesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RoutineAlgorithm) private readonly algorithm: RoutineAlgorithm,
    @Optional() @Inject(WORKOUT_CLOCK) private readonly clock?: () => Date,
  ) {}

  private async now(tx: Prisma.TransactionClient) {
    if (this.clock) return this.clock();
    const [row] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    return row.now;
  }
  private async locked<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient, now: Date) => Promise<T>,
  ) {
    return retryTransaction(() =>
      this.database.$transaction(
        async (tx) => {
          const users = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ${this.database.table('users')} WHERE id = ${userId}::uuid FOR NO KEY UPDATE
      `;
          if (!users.length)
            throw new NotFoundException('사용자를 찾을 수 없습니다.');
          return work(tx, await this.now(tx));
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 15_000,
        },
      ),
    );
  }

  async today(userId: string, key: string) {
    return this.locked(userId, async (tx, now) => {
      const previous = await tx.workoutRoutineRequest.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (previous)
        return {
          routine: this.response(
            await this.owned(tx, userId, previous.routineId),
            now,
          ),
          replayed: true,
        };
      const day = koreaDate(now);
      const referenceDate = new Date(`${day}T00:00:00Z`);
      const assignmentDate = referenceDate;
      const saved = await tx.workoutRoutine.findUnique({
        where: { userId_assignmentDate: { userId, assignmentDate } },
        include: includeRoutine,
      });
      if (saved) {
        await tx.workoutRoutineRequest.create({
          data: { userId, key, routineId: saved.id },
        });
        return { routine: this.response(saved, now), replayed: true };
      }
      // Settings are read once under a shared lock. Concurrent edits affect later generation.
      await tx.$queryRaw`SELECT user_id FROM ${this.database.table('user_preferences')} WHERE user_id = ${userId}::uuid FOR SHARE`;
      const preference = await tx.userPreference.findUnique({
        where: { userId },
      });
      if (!preference)
        throw new ServiceUnavailableException(
          '사용자 운동 설정이 누락되었습니다. 관리자 확인이 필요합니다.',
        );
      if (!preference.exerciseGoal)
        readiness('EXERCISE_GOAL_REQUIRED', '운동 목적을 먼저 선택해 주세요.');
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.dateOfBirth)
        readiness(
          'DATE_OF_BIRTH_REQUIRED',
          '운동 추천을 위해 생년월일을 입력해 주세요.',
        );
      const age = ageOnDate(dateOnly(user.dateOfBirth), day);
      if (age < 13 || age > 64)
        readiness(
          'AGE_UNSUPPORTED',
          '운동 추천은 현재 만 13~64세를 지원합니다.',
        );
      const [selected] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ${this.database.table('measurements')} WHERE user_id = ${userId}::uuid
        ORDER BY measured_on DESC, created_at DESC, id ASC LIMIT 1 FOR SHARE
      `;
      if (!selected)
        readiness(
          'MEASUREMENT_REQUIRED',
          '측정 기록을 한 건 이상 저장해 주세요.',
        );
      const measurement = serializeRecord(
        await tx.measurement.findUniqueOrThrow({
          where: { id: selected.id },
          include: includeRecord,
        }),
      );
      const logs = await this.logs(tx, userId, now);
      const input = routineInput({
        age,
        measurement,
        exerciseVolume: preference.exerciseVolume,
        exerciseGoal: preference.exerciseGoal,
        ownedTools: preference.ownedTools,
        currentDate: day,
        logs,
      });
      const decision = parseRoutineDecision(
        await this.algorithm.recommend(input),
      );
      const created = await tx.workoutRoutine.create({
        data: {
          userId,
          assignmentDate,
          referenceDate,
          createdAt: now,
          algorithmVersion: decision.algorithmVersion,
          dataVersion: decision.dataVersion,
          estimatedMinutes: decision.result.workout.estimatedMinutes,
          cardioRecommendation: decision.result.workout.cardioRecommendation,
          weightAdjustment: Prisma.DbNull,
          inputSnapshot: {
            ...input,
            measurementId: measurement.id,
            measurementRevision: measurement.revision,
            measurementCatalogVersion: measurement.catalogVersion,
            measuredOn: measurement.measuredOn,
            axes: measurement.axes,
            exerciseVolume: preference.exerciseVolume,
            exerciseGoal: preference.exerciseGoal,
            ownedTools: preference.ownedTools,
            preferenceUpdatedAt: preference.updatedAt.toISOString(),
          },
          items: {
            create: decision.result.workout.routine.map((item) => ({
              ...item,
              durationSeconds: decision.durations[item.videoId],
            })),
          },
          requests: { create: { userId, key } },
        },
        include: includeRoutine,
      });
      return { routine: this.response(created, now), replayed: false };
    });
  }

  private async owned(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    const row = await tx.workoutRoutine.findFirst({
      where: { id, userId },
      include: includeRoutine,
    });
    if (!row) throw new NotFoundException('루틴을 찾을 수 없습니다.');
    return row;
  }
  async get(userId: string, id: string) {
    return this.database.$transaction(
      async (tx) =>
        this.response(await this.owned(tx, userId, id), await this.now(tx)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async current(userId: string) {
    return this.database.$transaction(
      async (tx) => {
        const now = await this.now(tx);
        const row = await tx.workoutRoutine.findUnique({
          where: {
            userId_assignmentDate: {
              userId,
              assignmentDate: new Date(`${koreaDate(now)}T00:00:00Z`),
            },
          },
          include: includeRoutine,
        });
        return row ? this.response(row, now) : null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async history(
    userId: string,
    limit: number,
    cursor?: string,
    range?: HistoryRange,
  ) {
    return this.database.$transaction(
      async (tx) => {
        if (cursor) await this.owned(tx, userId, cursor);
        const rows = await tx.workoutRoutine.findMany({
          where: {
            userId,
            ...(range
              ? {
                  OR: [
                    { assignmentDate: historyBounds(range).assignmentDate },
                    {
                      items: {
                        some: { completedAt: historyBounds(range).completedAt },
                      },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ assignmentDate: 'desc' }, { id: 'asc' }],
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take: limit + 1,
          include: includeRoutine,
        });
        const now = await this.now(tx);
        const page = rows.slice(0, limit);
        return {
          serverKoreanDate: koreaDate(now),
          items: page.map((row) => this.response(row, now)),
          nextCursor: rows.length > limit ? page.at(-1)!.id : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async event(
    userId: string,
    routineId: string,
    itemId: string,
    key: string,
    input: PlaybackEventInput,
  ) {
    return this.locked(userId, async (tx, now) => {
      const routine = await this.owned(tx, userId, routineId);
      const item = routine.items.find((entry) => entry.id === itemId);
      if (!item) throw new NotFoundException('루틴 운동을 찾을 수 없습니다.');
      const hash = createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex');
      const prior = await tx.workoutRoutineEvent.findUnique({
        where: { itemId_key: { itemId, key } },
      });
      if (prior) {
        if (prior.requestHash !== hash)
          workoutConflict('같은 요청 키로 다른 이벤트를 저장할 수 없습니다.');
        return { routine: this.response(routine, now), replayed: true };
      }
      // Check the locked server receipt time only after exact idempotent replays.
      // Expired viewing must never update an item or append even an audit event.
      if (dateOnly(routine.assignmentDate) < koreaDate(now))
        throw new ConflictException({
          statusCode: 409,
          code: 'ROUTINE_EXPIRED',
          message: '지난 루틴의 시청은 운동 기록에 반영되지 않습니다.',
          ...recordingWindow(routine.assignmentDate, now),
        });
      if (dateOnly(routine.assignmentDate) > koreaDate(now))
        readiness(
          'ROUTINE_NOT_DUE',
          '배정 날짜부터 운동을 시작할 수 있습니다.',
        );
      if (input.occurredAt && new Date(input.occurredAt) > now)
        playbackInvalid('서버 시각 이후의 수행 시각을 입력할 수 없습니다.');
      const latest = await tx.workoutRoutineEvent.findFirst({
        where: { itemId, deviceId: input.deviceId },
        orderBy: { sequence: 'desc' },
      });
      if (latest && input.sequence <= latest.sequence)
        workoutConflict('이 기기의 이전 재생 이벤트입니다.');
      const media = mediaFor(
        item.videoId,
        item.videoUrl,
        item.durationSeconds,
        routine.dataVersion,
      );
      const normalized = normalizePlaybackProgress(
        input,
        item.durationSeconds,
        media.playbackStatus === 'verified'
          ? Math.max(item.durationSeconds, media.verifiedDurationSeconds!)
          : item.durationSeconds,
      );
      const intervals = unionIntervals(
        [...(item.intervals as PlaybackInterval[]), ...normalized.intervals],
        item.durationSeconds,
      );
      const watched = watchedSeconds(intervals);
      const status = nextRoutinePlaybackStatus(
        item.status,
        input.type,
        watched,
        item.durationSeconds,
      );
      const replayed = item.status === 'completed';
      const final = ['not_performed', 'interrupted', 'completed'].includes(
        status,
      );
      // A restart changes status, and progress may already contain new viewing.
      // Compare with the accumulated viewing at the last confirmed stop instead.
      const unchangedOutcome =
        final &&
        !replayed &&
        item.resultStatus === status &&
        watchedSeconds(item.intervals as PlaybackInterval[]) === watched &&
        (await this.finalizedWatchedSeconds(tx, item)) === watched;
      const wholeRoutineCompleted =
        !replayed &&
        status === 'completed' &&
        routine.items.every(
          (entry) =>
            entry.id === itemId ||
            (entry.status === 'completed' &&
              entry.completedAt !== null &&
              entry.completedAt <= now),
        );
      if (wholeRoutineCompleted)
        await recordActivityAchievement(
          this.database,
          tx,
          userId,
          now,
          'routine',
          routineId,
        );
      const updated = replayed
        ? item
        : await tx.workoutRoutineItem.update({
            where: { id: itemId },
            data: {
              status,
              intervals,
              positionSeconds: normalized.positionSeconds,
              revision: { increment: 1 },
              ...(final && !unchangedOutcome
                ? { resultStatus: status, performedAt: now }
                : {}),
              ...(status === 'completed' ? { completedAt: now } : {}),
            },
          });
      await tx.workoutRoutineEvent.create({
        data: {
          itemId,
          key,
          requestHash: hash,
          deviceId: input.deviceId,
          sequence: input.sequence,
          type: input.type,
          intervals: input.intervals,
          positionSeconds: input.positionSeconds,
          clientOccurredAt: input.occurredAt
            ? new Date(input.occurredAt)
            : null,
          receivedAt: now,
          resultingRevision: updated.revision,
        },
      });
      if (wholeRoutineCompleted)
        await recordRoutineReward(this.database, tx, userId, routineId, now);
      return {
        routine: this.response(await this.owned(tx, userId, routineId), now),
        replayed,
      };
    });
  }

  private async finalizedWatchedSeconds(
    tx: Prisma.TransactionClient,
    item: Routine['items'][number],
  ) {
    const stopped = await tx.workoutRoutineEvent.findFirst({
      where: { itemId: item.id, type: { in: ['pause', 'end', 'complete'] } },
      orderBy: { resultingRevision: 'desc' },
      select: { resultingRevision: true },
    });
    if (!stopped) return null;
    const events = await tx.workoutRoutineEvent.findMany({
      where: {
        itemId: item.id,
        resultingRevision: { lte: stopped.resultingRevision },
      },
      select: { intervals: true },
    });
    // Events retain raw media intervals. Rebuild the immutable catalog timeline,
    // including progress from every device, without counting verified overrun.
    const intervals = events
      .flatMap((event) => event.intervals as PlaybackInterval[])
      .filter(({ start }) => start < item.durationSeconds)
      .map(({ start, end }) => ({
        start,
        end: Math.min(end, item.durationSeconds),
      }));
    return watchedSeconds(unionIntervals(intervals, item.durationSeconds));
  }

  private async logs(tx: Prisma.TransactionClient, userId: string, now: Date) {
    const legacy = await tx.userCurriculumAssignment.findMany({
      where: {
        userId,
        resultStatus: { in: ['interrupted', 'completed'] },
        performedAt: { lte: now },
        assignmentDate: { not: null },
      },
      include: { curriculum: { include: { video: true } } },
    });
    const items = await tx.workoutRoutineItem.findMany({
      where: {
        routine: { userId },
        resultStatus: { in: ['interrupted', 'completed'] },
        performedAt: { lte: now },
      },
    });
    return [
      ...legacy.flatMap((row) =>
        row.curriculum.video && row.performedAt
          ? [
              {
                videoId: row.curriculum.video.videoId,
                date: row.performedAt.toISOString(),
                completed: row.resultStatus === 'completed',
              },
            ]
          : [],
      ),
      ...items.map((row) => ({
        videoId: row.videoId,
        date: row.performedAt!.toISOString(),
        completed: row.resultStatus === 'completed',
      })),
    ];
  }
  private response(row: Routine, now: Date) {
    const completed = row.items.filter(
      (item) => item.status === 'completed',
    ).length;
    const status =
      completed === row.items.length
        ? 'completed'
        : row.items.every((item) => item.status === 'assigned')
          ? 'assigned'
          : row.items.some((item) => item.status === 'in_progress')
            ? 'in_progress'
            : row.items.every((item) => item.status === 'not_performed')
              ? 'not_performed'
              : 'interrupted';
    return {
      id: row.id,
      koreanDate: dateOnly(row.assignmentDate),
      ...recordingWindow(row.assignmentDate, now),
      referenceDate: dateOnly(row.referenceDate),
      createdAt: row.createdAt,
      status,
      estimatedMinutes: row.estimatedMinutes,
      cardioRecommendation: row.cardioRecommendation,
      progress: { completedItems: completed, totalItems: row.items.length },
      algorithmVersion: row.algorithmVersion,
      dataVersion: row.dataVersion,
      inputSnapshot: row.inputSnapshot,
      weightAdjustment: row.weightAdjustment,
      routine: row.items.map((item) => ({
        id: item.id,
        order: item.order,
        videoId: item.videoId,
        title: item.title,
        videoUrl: item.videoUrl,
        slot: item.slot,
        prescription: item.prescription,
        ...mediaFor(
          item.videoId,
          item.videoUrl,
          item.durationSeconds,
          row.dataVersion,
        ),
        status: item.status,
        resultStatus: item.resultStatus,
        performedAt: item.performedAt,
        completedAt: item.completedAt,
        revision: item.revision,
        progress: {
          durationSeconds: item.durationSeconds,
          watchedSeconds: watchedSeconds(item.intervals as PlaybackInterval[]),
          positionSeconds: item.positionSeconds,
          intervals: item.intervals,
        },
      })),
    };
  }
}
