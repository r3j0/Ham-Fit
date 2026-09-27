import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import type { CurriculumAssignmentStatus } from '../generated/prisma/client.js';

export type PlaybackInterval = { start: number; end: number };
const eventSchema = z.strictObject({
  type: z.enum(['start', 'progress', 'pause', 'end', 'complete']),
  deviceId: z.uuid(),
  sequence: z.number().int().min(1).max(2147483647),
  intervals: z
    .array(
      z.strictObject({
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
      }),
    )
    .max(1000)
    .default([]),
  positionSeconds: z.number().nonnegative(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export type PlaybackEventInput = z.output<typeof eventSchema>;
export function playbackInvalid(message: string): never {
  throw new BadRequestException({
    statusCode: 400,
    code: 'INVALID_PLAYBACK_EVENT',
    message,
  });
}
export function workoutConflict(message: string): never {
  throw new ConflictException({
    statusCode: 409,
    code: 'WORKOUT_CONFLICT',
    message,
  });
}
export function parsePlaybackEvent(body: unknown): PlaybackEventInput {
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success)
    playbackInvalid('재생 이벤트의 형식과 숫자 범위를 확인해 주세요.');
  return parsed.data;
}
export function unionIntervals(
  intervals: readonly PlaybackInterval[],
  durationSeconds: number,
): PlaybackInterval[] {
  for (const { start, end } of intervals)
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > durationSeconds
    )
      playbackInvalid(
        '재생 구간은 영상 길이 안의 유한한 시작·종료 위치여야 합니다.',
      );
  const merged: PlaybackInterval[] = [];
  for (const interval of [...intervals].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end)
      last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}
export const watchedSeconds = (intervals: readonly PlaybackInterval[]) =>
  intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
export function nextPlaybackStatus(
  status: CurriculumAssignmentStatus,
  type: PlaybackEventInput['type'],
  watched: number,
  duration: number,
): CurriculumAssignmentStatus {
  if (status === 'completed') {
    if (type === 'complete') return status;
    workoutConflict('완료한 운동의 시청 기록은 변경할 수 없습니다.');
  }
  if (type === 'start') return 'in_progress';
  if (status !== 'in_progress')
    workoutConflict('먼저 운동을 시작하거나 이어하기를 선택해 주세요.');
  if (type === 'complete') return 'completed';
  if (type === 'end')
    return watched / duration >= 0.5 ? 'interrupted' : 'not_performed';
  return 'in_progress';
}
