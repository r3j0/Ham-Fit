import type { WorkoutRoutine } from "../../lib/workout-routine.ts";
export const routineId = "20000000-0000-4000-8000-000000000001";
export function routineFixture(): WorkoutRoutine {
  return {
    id: routineId,
    koreanDate: "2026-09-29",
    referenceDate: "2026-09-28",
    serverKoreanDate: "2026-09-29",
    createdAt: "2026-09-28T03:00:00.000Z",
    status: "assigned",
    estimatedMinutes: 6,
    progress: { completedItems: 0, totalItems: 3 },
    algorithmVersion: "test-algorithm",
    dataVersion: "test-data",
    inputSnapshot: {},
    weightAdjustment: {},
    routine: [1, 2, 3].map((n) => ({
      id: `20000000-0000-4000-8000-00000000000${n + 1}`,
      order: n,
      videoId: `test-${n}.mp4`,
      title: `루틴 운동 ${n}`,
      videoUrl: `http://openapi.kspo.or.kr/web/video/test-${n}.mp4`,
      slot: "strength_group",
      prescription: {
        doseType: n === 1 ? "reps" : "hold",
        value: n === 1 ? "10" : "20",
        unit: n === 1 ? "회" : "초",
        sets: 2,
        restSec: 30,
        text: n === 1 ? "10회 × 2세트" : "20초 × 2세트",
      },
      status: "assigned",
      resultStatus: null,
      revision: 1,
      performedAt: null,
      completedAt: null,
      playbackUrl: null,
      playbackStatus: "unavailable",
      verifiedDurationSeconds: null,
      progress: {
        durationSeconds: 60,
        watchedSeconds: 0,
        positionSeconds: 0,
        intervals: [],
      },
    })),
  };
}
