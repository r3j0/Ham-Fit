"use client";
import { useEffect, useReducer, useState } from "react";
/** Pass a stable loader. Session-scoped parent remounts prevent cross-account state. */
export type ResourcePolicy = {
  refreshIntervalMs?: number | false;
  staleTimeMs?: number;
  enabled?: boolean;
};
export function useApiResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  {
    refreshIntervalMs = false,
    staleTimeMs = 300000,
    enabled = true,
  }: ResourcePolicy = {},
) {
  const [snapshot, setSnapshot] = useState<{
    load: typeof load;
    data?: T;
    error?: unknown;
  }>();
  const [loading, setLoading] = useState(true);
  const [version, reload] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let reading = false;
    let lastRead = -Infinity;
    async function read() {
      if (reading) return;
      reading = true;
      lastRead = Date.now();
      setLoading(true);
      try {
        const value = await load(controller.signal);
        if (!controller.signal.aborted) {
          setSnapshot({ load, data: value });
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setSnapshot((previous) => ({
            load,
            data: previous?.load === load ? previous.data : undefined,
            error: e,
          }));
      } finally {
        reading = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    const focus = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRead >= staleTimeMs
      )
        void read();
    };
    const interval =
      refreshIntervalMs === false
        ? undefined
        : setInterval(focus, refreshIntervalMs);
    void read();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      clearInterval(interval);
      controller.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [load, version, refreshIntervalMs, staleTimeMs, enabled]);
  const current = snapshot?.load === load;
  return {
    data: current ? snapshot.data : undefined,
    error: current ? snapshot.error : undefined,
    loading: enabled && (loading || !current),
    reload,
  };
}
