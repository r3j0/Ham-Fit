import type { FormItem, FormMetadata } from "./measurement-form";

export interface MeasurementDraft {
  meta: FormMetadata;
  items: FormItem[];
  step: number;
  catalogVersion?: string;
  etag?: string;
  pending: { body: string; key: string } | null;
  uncertain: boolean;
  gone: boolean;
  dirty: boolean;
  extractionNotes?: string[];
}
const prefix = "modu-measurement-draft:v1:";
export const draftLifetime = 24 * 60 * 60 * 1000;
type DraftStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

function validDraft(value: unknown): value is MeasurementDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as MeasurementDraft;
  return (
    !!d.meta &&
    ["measuredOn", "age", "sex", "kind", "center", "grade"].every(
      (k) => typeof d.meta[k as keyof FormMetadata] === "string",
    ) &&
    ["standard", "simple", "unknown"].includes(d.meta.kind) &&
    Array.isArray(d.items) &&
    d.items.length <= 100 &&
    d.items.every(
      (i) =>
        i &&
        typeof i.code === "string" &&
        typeof i.value === "string" &&
        typeof i.grade === "string",
    ) &&
    [1, 2].includes(d.step) &&
    (d.step !== 2 || !!d.catalogVersion) &&
    (d.catalogVersion === undefined || typeof d.catalogVersion === "string") &&
    (d.etag === undefined ||
      (typeof d.etag === "string" && /^"[1-9]\d*"$/.test(d.etag))) &&
    (d.pending === null ||
      (!!d.pending &&
        typeof d.pending.body === "string" &&
        typeof d.pending.key === "string")) &&
    typeof d.uncertain === "boolean" &&
    (!d.uncertain || !!d.pending || !!d.etag) &&
    typeof d.gone === "boolean" &&
    (d.extractionNotes === undefined ||
      (Array.isArray(d.extractionNotes) &&
        d.extractionNotes.length <= 100 &&
        d.extractionNotes.every(
          (n) => typeof n === "string" && n.length <= 5000,
        ))) &&
    typeof d.dirty === "boolean"
  );
}

/** One tab's drafts. Credentials are never stored. A blocked Storage API falls back to memory. */
export function createDraftStore(
  storage: () => DraftStorage | undefined,
  now = Date.now,
) {
  let owner: string | null = null;
  const memory = new Map<string, string>();
  const writers = new Map<string, symbol>();
  const keyFor = (userId: string, id: string) => `${prefix}${userId}:${id}`;
  function persisted() {
    try {
      return storage();
    } catch {
      return undefined;
    }
  }
  function remove(key: string) {
    // Keep a tombstone so a failed removal cannot resurrect a discarded draft.
    memory.set(key, "");
    try {
      persisted()?.removeItem(key);
    } catch {
      try {
        persisted()?.setItem(key, "");
      } catch {
        /* This document remains cleared even if storage is entirely blocked. */
      }
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
  return {
    setOwner(userId: string) {
      if (owner !== userId) writers.clear();
      owner = userId;
      for (const key of keys())
        if (!key.startsWith(`${prefix}${userId}:`)) remove(key);
    },
    // Expiry requires reauthentication, not destruction of the user's unsaved work.
    suspend() {
      owner = null;
      writers.clear();
    },
    clear() {
      owner = null;
      writers.clear();
      for (const key of keys()) remove(key);
    },
    // A new form gets exclusive write access without changing the saved
    // request key/body. Releasing an old form cannot revoke its replacement.
    acquire(userId: string, id: string) {
      if (owner !== userId) return;
      const version = Symbol();
      writers.set(keyFor(userId, id), version);
      return version;
    },
    release(userId: string, id: string, version: symbol) {
      const key = keyFor(userId, id);
      if (writers.get(key) === version) writers.delete(key);
    },
    remove(userId: string, id: string, version: symbol) {
      if (
        owner !== userId ||
        !version ||
        writers.get(keyFor(userId, id)) !== version
      )
        return false;
      remove(keyFor(userId, id));
      return true;
    },
    read(userId: string, id: string): MeasurementDraft | undefined {
      if (owner !== userId) return;
      const key = keyFor(userId, id);
      let raw = memory.get(key);
      try {
        raw ??= persisted()?.getItem(key) ?? undefined;
      } catch {
        /* memory fallback */
      }
      if (!raw) return;
      try {
        const entry = JSON.parse(raw);
        if (
          validDraft(entry.draft) &&
          (entry.expiresAt > now() || entry.draft.uncertain)
        )
          return entry.draft;
      } catch {
        /* discard corrupt or obsolete data */
      }
      remove(key);
    },
    save(userId: string, id: string, draft: MeasurementDraft, version: symbol) {
      // An old in-flight form must not restore data after logout/account switching.
      if (
        owner !== userId ||
        !version ||
        writers.get(keyFor(userId, id)) !== version
      )
        return false;
      const key = keyFor(userId, id);
      const raw = JSON.stringify({ expiresAt: now() + draftLifetime, draft });
      memory.set(key, raw);
      try {
        persisted()?.setItem(key, raw);
      } catch {
        /* memory fallback */
      }
      return true;
    },
  };
}
export const measurementDrafts = createDraftStore(() =>
  typeof window === "undefined" ? undefined : window.sessionStorage,
);
