"use client";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { completedDate, koreanDateKey } from "@/lib/workout-history";
import { getActivityHistory } from "@/lib/workouts";
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
  const active =
    pathname === "/" ||
    pathname === "/workout" ||
    pathname.startsWith("/workouts/history/") ||
    pathname.startsWith("/account/workouts/history/");
  const [data, setData] = useState<{
    workouts: Workout[];
    routines: WorkoutRoutine[];
    legacyUnavailable: boolean;
    today: string;
  } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, reload] = useReducer((version: number) => version + 1, 0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let reading = false;
    async function load() {
      if (reading) return;
      reading = true;
      setLoading(true);
      try {
        const activity = await getActivityHistory(controller.signal);
        if (controller.signal.aborted) return;
        setData({
          ...activity,
          today:
            activity.workouts[0]?.serverKoreanDate ?? koreanDateKey(new Date()),
        });
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        reading = false;
      }
    }
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const interval = setInterval(focus, 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [retry, active]);
  const completed = useMemo(
    () =>
      new Set(
        (data?.workouts ?? [])
          .map(completedDate)
          .filter((day): day is string => day !== null),
      ),
    [data],
  );
  return (
    <HistoryContext.Provider
      value={{
        today: data?.today ?? koreanDateKey(new Date()),
        workouts: data?.workouts ?? [],
        routines: data?.routines ?? [],
        legacyUnavailable: data?.legacyUnavailable ?? false,
        legacyCompleted: new Set(
          (data?.workouts ?? [])
            .filter((row) => !row.routine)
            .map(completedDate)
            .filter((day): day is string => day !== null),
        ),
        completed,
        ready: data !== null,
        loading,
        error,
        reload,
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
