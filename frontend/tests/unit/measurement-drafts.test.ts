import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDraftStore,
  draftLifetime,
  type MeasurementDraft,
} from "../../lib/measurement-drafts.ts";

function storage() {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}
const draft: MeasurementDraft = {
  meta: {
    measuredOn: "2026-09-17",
    age: "25",
    sex: "",
    kind: "unknown",
    center: "",
    grade: "",
  },
  items: [{ code: "height", value: "170.1234567890123456789", grade: "" }],
  step: 2,
  catalogVersion: "catalog-v1",
  pending: null,
  uncertain: false,
  gone: false,
  dirty: true,
};
test("same-account reauthentication and reload recover exact input", () => {
  const tab = storage();
  const first = createDraftStore(() => tab);
  first.setOwner("alice");
  first.save("alice", "new", draft, first.acquire("alice", "new")!);
  first.suspend();
  assert.equal(first.read("alice", "new"), undefined);
  first.setOwner("alice");
  assert.deepEqual(first.read("alice", "new"), draft);
  const reloaded = createDraftStore(() => tab);
  reloaded.setOwner("alice");
  assert.deepEqual(reloaded.read("alice", "new"), draft);
});
test("account switching erases other accounts, including after a page reload", () => {
  const tab = storage();
  const first = createDraftStore(() => tab);
  first.setOwner("alice");
  first.save("alice", "new", draft, first.acquire("alice", "new")!);
  const reloaded = createDraftStore(() => tab);
  reloaded.setOwner("bob");
  assert.equal(reloaded.read("alice", "new"), undefined);
  assert.equal(reloaded.acquire("alice", "new"), undefined);
  reloaded.save("alice", "new", draft, Symbol("unauthorized"));
  reloaded.setOwner("alice");
  assert.equal(reloaded.read("alice", "new"), undefined);
  assert.equal(tab.length, 0);
});
test("explicit logout erases drafts and rejects late writes", () => {
  const tab = storage();
  const store = createDraftStore(() => tab);
  tab.setItem("unrelated", "keep");
  store.setOwner("alice");
  const version = store.acquire("alice", "new")!;
  store.save("alice", "new", draft, version);
  store.clear();
  store.save("alice", "new", draft, version);
  store.setOwner("alice");
  assert.equal(store.read("alice", "new"), undefined);
  assert.equal(tab.length, 1);
});
test("unresolved requests retain their original key and body even after the normal draft lifetime", () => {
  let time = 0;
  const tab = storage();
  const store = createDraftStore(
    () => tab,
    () => time,
  );
  const pending = {
    body: '{"items":[{"value":"170.1234567890123456789"}]}',
    key: "original-request-key",
  };
  store.setOwner("alice");
  store.save(
    "alice",
    "new",
    { ...draft, pending, uncertain: true },
    store.acquire("alice", "new")!,
  );
  time += draftLifetime + 1;
  const reloaded = createDraftStore(
    () => tab,
    () => time,
  );
  reloaded.setOwner("alice");
  assert.deepEqual(reloaded.read("alice", "new")?.pending, pending);
});
test("ordinary expired and malformed drafts are discarded", () => {
  let time = 0;
  const tab = storage();
  const store = createDraftStore(
    () => tab,
    () => time,
  );
  store.setOwner("alice");
  store.save("alice", "new", draft, store.acquire("alice", "new")!);
  time += draftLifetime + 1;
  assert.equal(store.read("alice", "new"), undefined);
  assert.equal(tab.length, 0);
  store.save("alice", "new", draft, store.acquire("alice", "new")!);
  const key = tab.key(0)!;
  tab.setItem(key, "not-json");
  const reloaded = createDraftStore(() => tab);
  reloaded.setOwner("alice");
  assert.equal(reloaded.read("alice", "new"), undefined);
  assert.equal(tab.length, 0);
});
test("storage failures preserve a draft in memory across reauthentication", () => {
  const store = createDraftStore(() => {
    throw new Error("Storage blocked");
  });
  store.setOwner("alice");
  store.save("alice", "new", draft, store.acquire("alice", "new")!);
  store.suspend();
  store.setOwner("alice");
  assert.deepEqual(store.read("alice", "new"), draft);
  store.clear();
  store.setOwner("alice");
  assert.equal(store.read("alice", "new"), undefined);
});
test("edit drafts retain their original ETag independently from new records", () => {
  const store = createDraftStore(storage);
  store.setOwner("alice");
  store.save(
    "alice",
    "record-1",
    { ...draft, etag: '"1"' },
    store.acquire("alice", "record-1")!,
  );
  store.save("alice", "new", draft, store.acquire("alice", "new")!);
  assert.equal(store.read("alice", "record-1")?.etag, '"1"');
  store.remove("alice", "new", store.acquire("alice", "new")!);
  assert.equal(store.read("alice", "new"), undefined);
  assert.equal(store.read("alice", "record-1")?.etag, '"1"');
});

for (const blocked of [false, true]) {
  test(`a replaced form cannot delete or overwrite its successor (blocked storage: ${blocked})`, () => {
    const tab = storage();
    const store = createDraftStore(() => (blocked ? undefined : tab));
    store.setOwner("alice");
    const first = store.acquire("alice", "new")!;
    const pending = { key: "original-key", body: "original-body" };
    store.save("alice", "new", { ...draft, pending, uncertain: true }, first);
    const retry = store.acquire("alice", "new")!;
    assert.deepEqual(store.read("alice", "new")?.pending, pending);
    store.release("alice", "new", first);
    assert.equal(store.remove("alice", "new", retry), true);
    const next = store.acquire("alice", "new")!;
    const fresh = {
      ...draft,
      items: [{ code: "height", value: "181.25", grade: "" }],
    };
    store.save("alice", "new", fresh, next);
    for (const old of [first, retry]) {
      assert.equal(store.remove("alice", "new", old), false);
      assert.equal(
        store.save("alice", "new", { ...draft, pending, uncertain: true }, old),
        false,
      );
      store.release("alice", "new", old);
    }
    assert.deepEqual(store.read("alice", "new"), fresh);
    assert.equal(store.save("alice", "new", fresh, next), true);
  });
}

test("leaving a form preserves its unresolved request but revokes writes", () => {
  const store = createDraftStore(() => undefined);
  store.setOwner("alice");
  const version = store.acquire("alice", "record-1")!;
  const unresolved = { ...draft, etag: '\"1\"', uncertain: true };
  store.save("alice", "record-1", unresolved, version);
  store.release("alice", "record-1", version);
  assert.equal(store.remove("alice", "record-1", version), false);
  assert.equal(store.save("alice", "record-1", draft, version), false);
  assert.deepEqual(store.read("alice", "record-1"), unresolved);
});

test("reauthentication does not revive a previous form's write access", () => {
  const store = createDraftStore(() => undefined);
  store.setOwner("alice");
  const version = store.acquire("alice", "new")!;
  store.save("alice", "new", draft, version);
  store.suspend();
  store.setOwner("alice");
  assert.equal(store.remove("alice", "new", version), false);
  assert.equal(store.save("alice", "new", draft, version), false);
  assert.deepEqual(store.read("alice", "new"), draft);
});

for (const blockWrites of [false, true]) {
  test(`failed removal cannot resurrect a discarded measurement draft (writes blocked: ${blockWrites})`, () => {
    const tab = storage();
    let blocked = false;
    const store = createDraftStore(() => ({
      ...tab,
      get length() {
        return tab.length;
      },
      setItem: (key: string, value: string) => {
        if (blocked && blockWrites) throw new Error("Storage blocked");
        tab.setItem(key, value);
      },
      removeItem: (key: string) => {
        if (blocked) throw new Error("Storage blocked");
        tab.removeItem(key);
      },
    }));
    store.setOwner("alice");
    store.save("alice", "new", draft, store.acquire("alice", "new")!);
    blocked = true;
    store.clear();
    store.setOwner("alice");
    assert.equal(store.read("alice", "new"), undefined);
    if (!blockWrites) {
      const reloaded = createDraftStore(() => tab);
      reloaded.setOwner("alice");
      assert.equal(reloaded.read("alice", "new"), undefined);
    }
  });
}
