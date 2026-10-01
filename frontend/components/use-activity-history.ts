"use client";
import { useCallback, useMemo, useState } from "react";
import { getActivityHistory } from "@/lib/workouts";
import { completedDate, koreanDateKey, shiftDay } from "@/lib/workout-history";
import { useApiResource } from "./use-api-resource";

/** Date-scoped history: never fetch unrelated months to draw a calendar. */
export function useActivityHistory(
  from: string,
  to: string,
  {
    enabled = true,
    recentDays,
    onServerDate,
  }: {
    enabled?: boolean;
    recentDays?: number;
    onServerDate?: (date: string) => void;
  } = {},
) {
  const [serverToday, setServerToday] = useState<string>();
  const today = serverToday ?? koreanDateKey(new Date());
  const rangeFrom = recentDays ? shiftDay(today, 1 - recentDays) : from;
  const rangeTo = recentDays ? today : to;
  const resource = useApiResource(
    useCallback(
      async (signal: AbortSignal) => {
        const value = await getActivityHistory(signal, {
          from: rangeFrom,
          to: rangeTo,
        });
        if (!signal.aborted && value.serverKoreanDate) {
          setServerToday(value.serverKoreanDate);
          onServerDate?.(value.serverKoreanDate);
        }
        return value;
      },
      [rangeFrom, rangeTo, onServerDate],
    ),
    {
      enabled,
      refreshIntervalMs: rangeTo >= today ? 300000 : false,
      staleTimeMs: 60000,
    },
  );
  const workouts = useMemo(
    () => resource.data?.workouts ?? [],
    [resource.data],
  );
  const routines = useMemo(
    () => resource.data?.routines ?? [],
    [resource.data],
  );
  return {
    workouts,
    routines,
    today,
    legacyUnavailable: resource.data?.legacyUnavailable ?? false,
    completed: useMemo(
      () =>
        new Set(
          workouts
            .map(completedDate)
            .filter((day): day is string => day !== null),
        ),
      [workouts],
    ),
    ready: resource.data !== undefined,
    loading: resource.loading,
    error: resource.error !== undefined,
    reload: resource.reload,
  };
}
