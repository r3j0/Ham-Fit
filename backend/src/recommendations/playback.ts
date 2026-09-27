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
/** Accept verified media overrun, but persist progress on the immutable catalog timeline. */
export function normalizePlaybackProgress(
  input: Pick<PlaybackEventInput, 'positionSeconds' | 'intervals'>,
  durationSeconds: number,
  acceptedDurationSeconds: number,
) {
  if (
    !Number.isFinite(input.positionSeconds) ||
    input.positionSeconds < 0 ||
    input.positionSeconds > acceptedDurationSeconds
  )
    playbackInvalid('재생 위치가 영상 길이를 벗어났습니다.');
  // Validate raw intervals before clipping; invalid and zero-length input must fail.
  const intervals = unionIntervals(input.intervals, acceptedDurationSeconds)
    .filter(({ start }) => start < durationSeconds)
    .map(({ start, end }) => ({ start, end: Math.min(end, durationSeconds) }));
  return {
    positionSeconds: Math.min(input.positionSeconds, durationSeconds),
    intervals,
  };
}
export function watchedSeconds(intervals: readonly PlaybackInterval[]) {
  // Kahan summation limits accumulated error without rounding each interval.
  let sum = 0;
  let correction = 0;
  for (const { start, end } of intervals) {
    const length = end - start - correction;
    const next = sum + length;
    correction = next - sum - length;
    sum = next;
  }
  return sum;
}
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
  if (type === 'end') {
    const threshold = duration / 2;
    // Only floating-point roundoff (about 9e-14 s at a 50 s threshold),
    // never the response's three-decimal display precision.
    const tolerance = 8 * Number.EPSILON * Math.max(watched, threshold);
    return watched >= threshold - tolerance ? 'interrupted' : 'not_performed';
  }
  return 'in_progress';
}
