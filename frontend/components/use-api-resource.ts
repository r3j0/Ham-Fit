"use client";
import { useEffect, useReducer, useState } from "react";
/** Pass a stable loader. Session-scoped parent remounts prevent cross-account state. */
export function useApiResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [version, reload] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    async function read() {
      if (reading) return;
      reading = true;
      setLoading(true);
      try {
        const value = await load(controller.signal);
        if (!controller.signal.aborted) {
          setData(value);
          setError(undefined);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(e);
      } finally {
        reading = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    const focus = () => {
      if (document.visibilityState === "visible") void read();
    };
    const interval = setInterval(focus, 60000);
    void read();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      clearInterval(interval);
      controller.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [load, version]);
  return { data, error, loading, reload };
}
