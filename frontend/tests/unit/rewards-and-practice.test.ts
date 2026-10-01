import assert from "node:assert/strict";
import { test } from "node:test";
import {
  doseRange,
  initialPractice,
  practiceReducer,
  nextRoutineHref,
} from "../../lib/workout-practice.ts";
import {
  parseMission,
  parseGroupDraw,
  parseTicket,
} from "../../lib/group-mission-contract.ts";
import {
  parseActivityReward,
  parsePersonalDraw,
  parsePersonalTicket,
  personalPolicy,
} from "../../lib/personal-reward-contract.ts";
import {
  parseCatalog,
  parseInventory,
  parsePurchase,
  supportedSelection,
} from "../../lib/shop-contract.ts";
import { parseAvatarOutfit } from "../../lib/avatar-outfit.ts";
import { routineFixture } from "../fixtures/routine.ts";
import type { Prescription } from "../../lib/workout-routine.ts";
const id = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = "2026-10-01T00:00:00.000Z";
const prescription = (doseType: Prescription["doseType"]): Prescription => ({
  doseType,
  value: "2~3",
  unit: doseType === "reps" ? "회" : doseType === "hold" ? "초 유지" : "초",
  sets: 2,
  restSec: 1,
  text: "서버 처방",
});
test("dose parsing honors only explicit supported units and ordered ranges", () => {
  assert.deepEqual(doseRange(prescription("reps")), { min: 2, max: 3 });
  for (const value of ["3~2", "0", "1.5", "10초", "최대한", "99999999999"])
    assert.equal(doseRange({ ...prescription("hold"), value }), null);
  assert.equal(doseRange({ ...prescription("timed"), unit: "분" }), null);
});
test("repetitions require target count, include rest, and never advance beyond prescribed sets", () => {
  const p = prescription("reps");
  let s = initialPractice(p);
  s = practiceReducer(p, s, { type: "target", value: 3 });
  s = practiceReducer(p, s, { type: "start", now: 0 });
  assert.equal(practiceReducer(p, s, { type: "finish" }).phase, "work");
  for (let i = 0; i < 4; i++) s = practiceReducer(p, s, { type: "rep" });
  assert.equal(s.reps, 3);
  s = practiceReducer(p, s, { type: "finish" });
  assert.equal(s.phase, "rest");
  s = practiceReducer(p, s, { type: "skipRest" });
  assert.equal(s.set, 2);
  assert.equal(s.reps, 0);
  s = practiceReducer(p, s, { type: "start", now: 0 });
  for (let i = 0; i < 3; i++) s = practiceReducer(p, s, { type: "rep" });
  s = practiceReducer(p, s, { type: "finish" });
  assert.equal(s.phase, "done");
  assert.deepEqual(practiceReducer(p, s, { type: "start", now: 9999 }), s);
});
for (const kind of ["hold", "timed"] as const)
  test(`${kind} uses monotonic deadlines, pauses while hidden and rests between sets`, () => {
    const p = prescription(kind);
    let s = initialPractice(p);
    s = practiceReducer(p, s, { type: "start", now: 100 });
    s = practiceReducer(p, s, { type: "pause", now: 1100 });
    assert.equal(s.remainingMs, 1000);
    assert.equal(s.deadline, null);
    s = practiceReducer(p, s, { type: "tick", now: 500000 });
    assert.equal(s.phase, "work");
    s = practiceReducer(p, s, { type: "start", now: 600000 });
    s = practiceReducer(p, s, { type: "tick", now: 602000 });
    assert.equal(s.phase, "rest");
    s = practiceReducer(p, s, { type: "start", now: 700000 });
    s = practiceReducer(p, s, { type: "tick", now: 701000 });
    assert.equal(s.phase, "ready");
    assert.equal(s.set, 2);
    s = practiceReducer(p, s, { type: "start", now: 800000 });
    s = practiceReducer(p, s, { type: "tick", now: 802000 });
    assert.equal(s.phase, "done");
  });
test("unknown prescription stays manual; no guessed timer or completion writes", () => {
  const p = {
    ...prescription("timed"),
    value: "운동 설명 확인",
    restSec: 0,
    sets: 1,
  };
  let s = initialPractice(p);
  s = practiceReducer(p, s, { type: "start", now: 0 });
  assert.equal(s.deadline, null);
  s = practiceReducer(p, s, { type: "finish" });
  assert.equal(s.phase, "done");
});
test("sequence chooses first unfinished item and completion only when all are complete", () => {
  const r = routineFixture();
  const original = [...r.routine];
  r.routine.reverse();
  assert.ok(nextRoutineHref(r).endsWith(original[0].id));
  assert.deepEqual(r.routine, [...original].reverse());
  r.routine.reverse();
  assert.ok(nextRoutineHref(r).endsWith(r.routine[0].id));
  r.routine[0].status = "completed";
  assert.ok(nextRoutineHref(r).endsWith(r.routine[1].id));
  r.routine[2].status = "completed";
  assert.ok(nextRoutineHref(r).endsWith(r.routine[1].id));
  r.routine[1].status = "completed";
  assert.equal(nextRoutineHref(r), `/workout-routines/${r.id}/complete`);
});
const mission = () => ({
  id: id(1),
  groupId: id(2),
  status: "in_progress",
  startedAt: date,
  completedAt: null,
  memberCount: 2,
  waterCount: 3,
  totalTarget: 28,
  stage: "sprout",
  stageTargets: { seed: 0, sprout: 2, stem: 6, bud: 14, sunflower: 28 },
  policyVersion: "sunflower-2026-09-30-v1",
  me: { eligible: false, reason: "not_in_snapshot", waterCount: 0 },
});
test("mission respects snapshot exclusion and rejects contradictory growth", () => {
  assert.equal(parseMission(mission()).id, id(1));
  assert.deepEqual(parseMission({ id: null, status: "not_started" }), {
    id: null,
    status: "not_started",
  });
  for (const patch of [
    { waterCount: 29 },
    { stage: "sunflower" },
    { status: "completed" },
    { me: { eligible: true, reason: "not_in_snapshot", waterCount: 0 } },
  ])
    assert.throws(() => parseMission({ ...mission(), ...patch }));
});
const ticket = () => ({
  id: id(1),
  roundId: id(2),
  createdAt: date,
  policyVersion: "v1",
  status: "available",
  usable: true,
  usedAt: null,
  invalidatedAt: null,
});
test("invalidated and spent tickets cannot claim to be usable", () => {
  assert.equal(parseTicket(ticket()).usable, true);
  assert.throws(() =>
    parseTicket({ ...ticket(), status: "used", usedAt: date }),
  );
  assert.throws(() =>
    parseTicket({ ...ticket(), status: "invalidated", invalidatedAt: date }),
  );
});
const draw = () => ({
  id: id(1),
  ticketId: id(2),
  roundId: id(3),
  drawnAt: date,
  policyVersion: "sunflower-2026-09-30-v1",
  result: "contributors_3",
  amountPerRecipient: 3,
  recipients: [{ userId: id(4), amount: 3 }],
  myReward: [{ amount: 3, transactionId: id(5) }],
});
test("group reward uses per-recipient amounts without multiplying or adding self reward", () => {
  assert.equal(parseGroupDraw(draw()).myReward[0].amount, 3);
  assert.throws(() => parseGroupDraw({ ...draw(), amountPerRecipient: 6 }));
  assert.throws(() =>
    parseGroupDraw({
      ...draw(),
      myReward: [{ amount: 6, transactionId: id(5) }],
    }),
  );
});
const inventory = () => ({
  currency: { balance: 100 },
  inventory: [
    { productId: "character.cream", source: "default", acquiredAt: date },
  ],
});
test("inventory and purchases reject malformed balance, duplicate ownership and mismatched receipt", () => {
  assert.equal(parseInventory(inventory()).currency.balance, 100);
  assert.throws(() =>
    parseInventory({ ...inventory(), currency: { balance: -1 } }),
  );
  assert.throws(() =>
    parseInventory({
      ...inventory(),
      inventory: [...inventory().inventory, ...inventory().inventory],
    }),
  );
  const p = {
    ...inventory(),
    replayed: true,
    purchase: {
      id: id(3),
      productId: "character.cream",
      price: 30,
      catalogRevision: 2,
      createdAt: date,
    },
  };
  assert.equal(parsePurchase(p, "character.cream", 2).currency.balance, 100);
  assert.throws(() => parsePurchase(p, "pose.run", 2));
  assert.throws(() => parsePurchase(p, "character.cream", 3));
});
test("whole outfit supports independent layers but rejects slot conflicts and mismatched ownership IDs", () => {
  const clothes = [
    {
      productId: "clothing.helmet",
      slot: "hat",
      renderKey: "item-mumcdhbz",
      occupiesSlots: ["hat"],
    },
    {
      productId: "clothing.jacket",
      slot: "top",
      renderKey: "item-mumd1fjp",
      occupiesSlots: ["top"],
    },
  ];
  const o = {
    characterId: "character.cream",
    poseId: "pose.basic",
    revision: 1,
    updatedAt: date,
    clothingIds: clothes.map((c) => c.productId),
    rendering: { variant: "cream", pose: "basic", clothing: clothes },
  };
  assert.equal(parseAvatarOutfit(o).rendering.clothing.length, 2);
  assert.throws(() =>
    parseAvatarOutfit({ ...o, clothingIds: ["clothing.helmet"] }),
  );
  assert.throws(() =>
    parseAvatarOutfit({
      ...o,
      rendering: {
        ...o.rendering,
        clothing: [
          clothes[0],
          { ...clothes[1], slot: "hat", occupiesSlots: ["hat"] },
        ],
      },
    }),
  );
});
test("only server-listed full combinations can be saved", () => {
  const product = (id: string, kind: string, renderKey: string) => ({
    id,
    kind,
    renderKey,
    slot: null,
    occupiesSlots: [],
    ownershipScope: "shared",
    scopeCharacterId: null,
    saleStatus: "default",
    price: null,
    priceProvisional: false,
    catalogRevision: 1,
  });
  const selection = {
    characterId: "character.cream",
    poseId: "pose.basic",
    clothingIds: [],
  };
  const c = parseCatalog({
    products: [
      product("character.cream", "character", "cream"),
      product("pose.basic", "pose", "basic"),
    ],
    combinations: [selection],
  });
  assert.equal(supportedSelection(c, selection), true);
  assert.equal(
    supportedSelection(c, { ...selection, clothingIds: ["clothing.helmet"] }),
    false,
  );
});
const receipt = () => ({
  routineId: id(1),
  koreanDate: "2026-10-01",
  seed: { status: "granted", amount: 1, transactionId: id(2) },
  waters: [{ groupId: id(3), groupName: "그룹", roundId: id(4), amount: 1 }],
  personalTicketIds: [],
});
test("seed and water screens require authoritative unique receipt entries", () => {
  assert.equal(parseActivityReward(receipt()).seed.amount, 1);
  assert.throws(() =>
    parseActivityReward({
      ...receipt(),
      seed: { status: "granted", amount: 1, transactionId: null },
    }),
  );
  assert.throws(() =>
    parseActivityReward({
      ...receipt(),
      seed: { status: "already_granted", amount: 1, transactionId: id(2) },
    }),
  );
  assert.throws(() =>
    parseActivityReward({
      ...receipt(),
      waters: [...receipt().waters, ...receipt().waters],
    }),
  );
});
const personalAchievement = () => ({
  id: id(3),
  koreanDate: "2026-10-05",
  segmentStartDate: "2026-10-01",
  streakDays: 5,
  achievedAt: "2026-10-05T00:00:00Z",
  sourceKind: "routine",
  sourceId: id(4),
});
const personalDraw = () => ({
  id: id(1),
  ticketId: id(2),
  drawnAt: "2026-10-05T01:00:00Z",
  policyVersion: "streak-2026-10-01-v1",
  achievement: personalAchievement(),
  originalResult: "seeds_1",
  actualReward: {
    kind: "seeds",
    amount: 1,
    productId: null,
    transactionId: id(5),
  },
  fallback: { applied: false, reason: null },
});
test("personal tickets preserve actual milestone evidence and used state", () => {
  const ticket = {
    ...personalAchievement(),
    achievementId: id(3),
    id: id(2),
    createdAt: date,
    policyVersion: "streak-2026-10-01-v1",
    status: "available",
    usable: true,
    usedAt: null,
  };
  assert.equal(parsePersonalTicket(ticket).streakDays, 5);
  assert.equal(
    parsePersonalTicket({
      ...ticket,
      status: "used",
      usable: false,
      usedAt: date,
    }).usable,
    false,
  );
  for (const change of [
    { streakDays: 6 },
    { segmentStartDate: "2026-10-02" },
    { usable: false },
    { status: "used" },
    { achievementId: "bad" },
  ]) {
    assert.throws(() => parsePersonalTicket({ ...ticket, ...change }));
  }
});
test("personal draws distinguish seeds, actual items, and documented fallback without inventory synthesis", () => {
  assert.equal(parsePersonalDraw(personalDraw()).actualReward.amount, 1);
  const fallback = {
    ...personalDraw(),
    originalResult: "clothing",
    actualReward: { ...personalDraw().actualReward, amount: 50 },
    fallback: { applied: true, reason: "no_eligible_product" },
  };
  assert.equal(parsePersonalDraw(fallback).fallback.applied, true);
  const item = {
    ...personalDraw(),
    originalResult: "pose",
    actualReward: {
      kind: "pose",
      amount: 1,
      productId: "pose.run",
      transactionId: null,
    },
  };
  assert.equal(parsePersonalDraw(item).actualReward.productId, "pose.run");
  assert.throws(() =>
    parsePersonalDraw({ ...item, originalResult: "clothing" }),
  );
  assert.throws(() =>
    parsePersonalDraw({
      ...fallback,
      fallback: { applied: false, reason: null },
    }),
  );
  assert.throws(() =>
    parsePersonalDraw({
      ...item,
      actualReward: { ...item.actualReward, amount: 0 },
    }),
  );
  assert.throws(() =>
    parsePersonalDraw({
      ...personalDraw(),
      achievement: { ...personalAchievement(), streakDays: 10 },
    }),
  );
});
test("the versioned personal probability display matches the published backend policy", () => {
  assert.deepEqual(
    personalPolicy.map((row) => row.probability),
    [60, 25, 10, 4.3, 0.6, 0.1],
  );
  assert.ok(
    Math.abs(personalPolicy.reduce((n, row) => n + row.probability, 0) - 100) <
      1e-8,
  );
});
