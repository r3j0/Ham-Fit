export interface PendingWorkoutRequest {
  key: string;
  body: string;
}
type JournalStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;
const prefix = "modu-workout-journal:v1:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per-tab durable requests, without credentials. Expiry suspends; logout erases. */
export function createWorkoutJournal(
  storage: () => JournalStorage | undefined,
) {
  let owner: string | null = null;
  const memory = new Map<string, string>();
  const writers = new Map<string, symbol>();
  function persisted() {
    try {
      return storage();
    } catch {
      return undefined;
    }
  }
  function keys() {
    const all = new Set(memory.keys());
    try {
      const store = persisted();
      if (store)
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (key?.startsWith(prefix)) all.add(key);
        }
    } catch {
      /* memory fallback */
    }
    return all;
  }
  function remove(key: string) {
    // Keep a tombstone if removeItem is blocked; do not resurrect an acknowledged disk request.
    memory.set(key, "[]");
    try {
      persisted()?.removeItem(key);
    } catch {
      /* memory fallback */
    }
  }
  return {
    setOwner(userId: string) {
      if (owner !== userId) writers.clear();
      owner = userId;
      for (const key of keys())
        if (!key.startsWith(`${prefix}${userId}:`)) remove(key);
    },
    suspend() {
      owner = null;
      writers.clear();
    },
    clear() {
      owner = null;
      writers.clear();
      for (const key of keys()) remove(key);
    },
    acquire(userId: string, id: string) {
      const key = `${prefix}${userId}:${id}`;
      const version = Symbol();
      if (owner === userId) writers.set(key, version);
      const active = () => owner === userId && writers.get(key) === version;
      return {
        active,
        read(): PendingWorkoutRequest[] {
          if (!active()) return [];
          let raw = memory.get(key);
          try {
            raw ??= persisted()?.getItem(key) ?? undefined;
          } catch {
            /* memory fallback */
          }
          if (!raw) return [];
          try {
            const value = JSON.parse(raw);
            if (
              Array.isArray(value) &&
              value.every(
                (r) =>
                  r &&
                  typeof r.key === "string" &&
                  uuid.test(r.key) &&
                  typeof r.body === "string",
              )
            )
              return value;
          } catch {
            /* corrupt storage is not a valid request */
          }
          remove(key);
          return [];
        },
        save(requests: PendingWorkoutRequest[]) {
          if (!active()) return false;
          if (!requests.length) remove(key);
          else {
            const raw = JSON.stringify(requests);
            memory.set(key, raw);
            try {
              persisted()?.setItem(key, raw);
            } catch {
              /* memory fallback */
            }
          }
          return true;
        },
        release() {
          if (active()) writers.delete(key);
        },
      };
    },
  };
}
export type WorkoutWriter = ReturnType<
  ReturnType<typeof createWorkoutJournal>["acquire"]
>;
export const workoutJournal = createWorkoutJournal(() =>
  typeof window === "undefined" ? undefined : window.sessionStorage,
);
