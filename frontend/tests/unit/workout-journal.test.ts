import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkoutJournal } from "../../lib/workout-journal.ts";
function storage() {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (n: number) => [...data.keys()][n] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
const request = { key: "f4d4e684-772a-456c-a5d3-9b81d8b5ac50", body: "{}" };
test("a request survives reload and same-user reauthentication byte-for-byte", () => {
  const disk = storage();
  const journal = createWorkoutJournal(() => disk);
  journal.setOwner("one");
  const old = journal.acquire("one", "today");
  old.save([request]);
  journal.suspend();
  assert.equal(old.save([]), false);
  const reloaded = createWorkoutJournal(() => disk);
  reloaded.setOwner("one");
  assert.deepEqual(reloaded.acquire("one", "today").read(), [request]);
});
test("replacement writers, logout and account switching cannot accept a late response", () => {
  const disk = storage(),
    journal = createWorkoutJournal(() => disk);
  journal.setOwner("one");
  const old = journal.acquire("one", "today");
  old.save([request]);
  const current = journal.acquire("one", "today");
  assert.equal(old.save([]), false);
  old.release();
  assert.deepEqual(current.read(), [request]);
  journal.clear();
  assert.equal(current.save([request]), false);
  assert.equal(disk.length, 0);
  journal.setOwner("one");
  journal.acquire("one", "today").save([request]);
  journal.setOwner("two");
  assert.equal(disk.length, 0);
});
test("blocked storage still supports request recovery within this document", () => {
  const journal = createWorkoutJournal(() => {
    throw new Error("blocked");
  });
  journal.setOwner("one");
  journal.acquire("one", "today").save([request]);
  journal.suspend();
  journal.setOwner("one");
  assert.deepEqual(journal.acquire("one", "today").read(), [request]);
});
