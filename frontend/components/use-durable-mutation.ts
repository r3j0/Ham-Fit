"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/http";
import {
  workoutJournal,
  type PendingWorkoutRequest,
  type WorkoutWriter,
} from "@/lib/workout-journal";
import { useSession } from "./session-provider";

/** Retry an uncertain financial write with the original body and key, even after reload. */
export function useDurableMutation(resource: string) {
  const userId = useSession().user!.id;
  const writer = useRef<WorkoutWriter | null>(null),
    guard = useRef(false);
  const [pending, setPending] = useState<PendingWorkoutRequest>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const lease = workoutJournal.acquire(userId, resource);
    writer.current = lease;
    queueMicrotask(() => {
      if (lease.active()) setPending(lease.read()[0]);
    });
    return () => {
      lease.release();
      writer.current = null;
    };
  }, [userId, resource]);
  async function run<T>(
    body: string,
    send: (body: string, key: string) => Promise<T>,
  ): Promise<T | undefined> {
    const lease = writer.current;
    if (!lease?.active() || guard.current) return;
    const request = lease.read()[0] ?? { body, key: crypto.randomUUID() };
    guard.current = true;
    lease.save([request]);
    setPending(request);
    setBusy(true);
    try {
      const value = await send(request.body, request.key);
      if (!lease.active()) return;
      lease.save([]);
      setPending(undefined);
      return value;
    } catch (error) {
      if (!lease.active()) return;
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 408, 429].includes(error.status)
      ) {
        lease.save([]);
        setPending(undefined);
      }
      throw error;
    } finally {
      guard.current = false;
      if (lease.active()) setBusy(false);
    }
  }
  return { pending, busy, run };
}
