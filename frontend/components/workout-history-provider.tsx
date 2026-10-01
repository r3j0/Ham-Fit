"use client";
import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";
import { completedDate, koreanDateKey, shiftDay } from "@/lib/workout-history";
import { useActivityHistory } from "./use-activity-history";
import type { Workout } from "@/lib/workout-types";
import type { WorkoutRoutine } from "@/lib/workout-routine";
import { Loading, Notice } from "./ui";

type History = {
  today: string;
  workouts: Workout[];
  routines: WorkoutRoutine[];
  legacyUnavailable: boolean;
  legacyCompleted: ReadonlySet<string>;
  completed: ReadonlySet<string>;
  ready: boolean;
  loading: boolean;
  error: boolean;
  reload: () => void;
};
const HistoryContext = createContext<History | null>(null);

/** RequireSession remounts this provider on authenticated user/generation changes. */
export function WorkoutHistoryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === "/" || pathname === "/workout";
  const today = koreanDateKey(new Date());
  const history = useActivityHistory(shiftDay(today, -6), today, {
    enabled: active,
    recentDays: 7,
  });
  return (
    <HistoryContext.Provider
      value={{
        ...history,
        legacyCompleted: new Set(
          history.workouts
            .filter((row) => !row.routine)
            .map(completedDate)
            .filter((day): day is string => day !== null),
        ),
      }}
    >
      {children}
    </HistoryContext.Provider>
  );
}

export function useWorkoutHistory() {
  const history = useContext(HistoryContext);
  if (!history) throw new Error("Workout history requires its provider");
  return history;
}

export function WorkoutHistoryFeedback() {
  const { error, loading, reload, legacyUnavailable } = useWorkoutHistory();
  return error || legacyUnavailable ? (
    <div className="stack-sm">
      <Notice>
        {legacyUnavailable && !error
          ? "이전 단일 운동 기록은 지금 불러올 수 없어요. 잠시 후 다시 확인해 주세요."
          : "운동 기록을 불러오지 못했어요. 다시 확인해 주세요."}
      </Notice>
      <button className="text-button" disabled={loading} onClick={reload}>
        운동 기록 다시 불러오기
      </button>
    </div>
  ) : (
    <Loading label="운동 기록을 불러오고 있어요" />
  );
}
