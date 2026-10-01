import { expect, test, type Page } from "@playwright/test";
import {
  installApi,
  testRecord,
  testUser,
  testWorkout,
} from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";
import { rewardId as id, rewardDate as date } from "./avatar-rewards-fixtures";

async function setup(page: Page, count = 2) {
  await installApi(page, testRecord());
  const routine = routineFixture();
  routine.status = "completed";
  routine.progress.completedItems = routine.routine.length;
  for (const item of routine.routine) {
    item.status = "completed";
    item.resultStatus = "completed";
    item.completedAt = routine.serverTime;
    item.performedAt = routine.serverTime;
    item.progress.watchedSeconds = 48;
    item.progress.intervals = [{ start: 0, end: 48 }];
  }
  await page.route("**/api/v2/workout-routines/**", (route) =>
    route.fulfill({ json: routine }),
  );
  const options = Array.from({ length: count }, (_, n) => ({
    groupId: id(n + 1),
    groupName: ["아침 운동", "저녁 산책"][n],
    roundId: id(n + 10),
    waterCount: 3,
    totalTarget: 28,
    stage: "sprout",
  }));
  const state = {
    selected: count === 1 ? options[0] : null,
    lose: false,
    fail: false,
    expired: false,
    writes: [] as { key: string; body: string }[],
  };
  const water = () => ({
    sourceKind: "routine",
    sourceId: routine.id,
    koreanDate: routine.koreanDate,
    status: state.selected
      ? "contributed"
      : state.expired || !options.length
        ? "unavailable"
        : "pending",
    reason: state.selected
      ? null
      : state.expired
        ? "expired"
        : !options.length
          ? "no_eligible_missions"
          : null,
    options: state.selected || state.expired ? [] : options,
    contribution: state.selected
      ? {
          groupId: state.selected.groupId,
          groupName: state.selected.groupName,
          roundId: state.selected.roundId,
          amount: 1,
        }
      : null,
  });
  await page.route("**/api/v1/users/me/group-mission-water**", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      state.writes.push({
        key: req.headers()["idempotency-key"],
        body: req.postData()!,
      });
      const input = req.postDataJSON();
      state.selected = options.find((o) => o.groupId === input.groupId)!;
      if (state.lose) {
        state.lose = false;
        return route.abort();
      }
      return route.fulfill({
        status: 201,
        json: { water: water(), replayed: state.writes.length > 1 },
      });
    }
    return state.fail
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: water() });
  });
  return { state, routine, base: `/workout-routines/${routine.id}/complete` };
}
test("운동 완료 → 스트릭 → 물 주기에서 한 그룹을 선택하고 선택 결과를 새로고침 후에도 표시한다", async ({
  page,
}, info) => {
  const { state, base } = await setup(page);
  await page.goto(base);
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(`${base}/streak`);
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(`${base}/water`);
  await expect(
    page.getByRole("heading", { name: "어느 그룹에 물을 줄까요?" }),
  ).toBeVisible();
  const submit = page.getByRole("button", { name: "선택한 그룹에 물 주기" });
  await expect(submit).toBeDisabled();
  for (const width of [320, 390, 1218]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`water-choice-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("radio", { name: /저녁 산책/ }).check();
  await submit.click();
  await expect(
    page.getByRole("heading", { name: "저녁 산책 그룹에 물을 주었어요!" }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(JSON.parse(state.writes[0].body).groupId).toBe(id(2));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "저녁 산책 그룹에 물을 주었어요!" }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});
test("참여 미션이 하나면 자동 반영된 그룹을 보여주고 추가 지급 요청을 보내지 않는다", async ({
  page,
}, info) => {
  const { state, base } = await setup(page, 1);
  await page.goto(`${base}/water`);
  await expect(
    page.getByRole("heading", { name: "아침 운동 그룹에 물을 주었어요!" }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("water-single.png"),
    fullPage: true,
  });
  expect(state.writes).toHaveLength(0);
});
test("물 선택의 응답 유실은 원래 그룹과 요청 키로 복구하고 다른 그룹을 고를 수 없게 한다", async ({
  page,
}) => {
  const { state, base } = await setup(page);
  state.lose = true;
  await page.goto(`${base}/water`);
  await page.getByRole("radio", { name: /아침 운동/ }).check();
  await page.getByRole("button", { name: "선택한 그룹에 물 주기" }).click();
  await expect(
    page.getByRole("button", { name: "이전 물 주기 결과 확인" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "이전 물 주기 결과 확인" }).click();
  await expect(
    page.getByRole("heading", { name: "아침 운동 그룹에 물을 주었어요!" }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
});
test("미참여·만료·조회 실패는 물 지급 성공으로 표시하지 않는다", async ({
  page,
}) => {
  const { state, base } = await setup(page, 0);
  await page.goto(`${base}/water`);
  await expect(
    page.getByText("운동을 마칠 때 참여 중인 그룹 미션이 없었어요."),
  ).toBeVisible();
  await expect(page.getByText(/그룹에 물을 주었어요!/)).toHaveCount(0);
  state.expired = true;
  await page.reload();
  await expect(
    page.getByText("물 주기는 운동을 완료한 날에만 할 수 있어요."),
  ).toBeVisible();
  state.fail = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "물 주기 다시 확인" }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
});
test("기존 일별 운동 완료 화면도 원래 배정의 물을 선택해 반영한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  const workout = {
    ...testWorkout,
    status: "completed",
    resultStatus: "completed",
    completedAt: date,
    performedAt: date,
  };
  await page.route(`**/api/v1/workouts/${workout.id}`, (route) =>
    route.fulfill({ json: workout }),
  );
  const option = {
    groupId: id(1),
    groupName: "기존 운동 그룹",
    roundId: id(10),
    waterCount: 3,
    totalTarget: 28,
    stage: "sprout",
  };
  let chosen = false;
  const writes: unknown[] = [];
  const water = () => ({
    sourceKind: "daily_assignment",
    sourceId: workout.id,
    koreanDate: workout.koreanDate,
    status: chosen ? "contributed" : "pending",
    reason: null,
    options: chosen ? [] : [option],
    contribution: chosen
      ? {
          groupId: option.groupId,
          groupName: option.groupName,
          roundId: option.roundId,
          amount: 1,
        }
      : null,
  });
  await page.route("**/api/v1/users/me/group-mission-water**", (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      chosen = true;
      return route.fulfill({
        status: 201,
        json: { water: water(), replayed: false },
      });
    }
    expect(new URL(route.request().url()).searchParams.get("sourceKind")).toBe(
      "daily_assignment",
    );
    return route.fulfill({ json: water() });
  });
  await page.goto(`/workouts/${workout.id}`);
  await page.getByRole("radio", { name: /기존 운동 그룹/ }).check();
  await page.getByRole("button", { name: "선택한 그룹에 물 주기" }).click();
  await expect(
    page.getByRole("heading", {
      name: "기존 운동 그룹 그룹에 물을 주었어요!",
    }),
  ).toBeVisible();
  expect(writes).toEqual([
    {
      sourceKind: "daily_assignment",
      sourceId: workout.id,
      groupId: option.groupId,
    },
  ]);
});
test("그룹 미션은 성장 단계별 이미지와 물·내 기여만 간결하게 보여준다", async ({
  page,
}, info) => {
  await installApi(page, testRecord());
  const groupId = id(1);
  const phases = [
    { stage: "seed", name: "씨앗", water: 0 },
    { stage: "sprout", name: "새싹", water: 2 },
    { stage: "stem", name: "줄기", water: 6 },
    { stage: "bud", name: "꽃봉오리", water: 14 },
    { stage: "sunflower", name: "해바라기", water: 28 },
  ];
  let phase = phases[2];
  await page.route(`**/api/v1/groups/${groupId}**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/missions/current"))
      return route.fulfill({
        json: {
          id: id(10),
          groupId,
          status: phase.water === 28 ? "completed" : "in_progress",
          startedAt: date,
          completedAt: phase.water === 28 ? date : null,
          memberCount: 2,
          waterCount: phase.water,
          totalTarget: 28,
          stage: phase.stage,
          stageTargets: { seed: 0, sprout: 2, stem: 6, bud: 14, sunflower: 28 },
          policyVersion: "sunflower-2026-09-30-v1",
          me: {
            eligible: true,
            reason: "eligible",
            waterCount: phase.water === 28 ? 14 : Math.min(phase.water, 3),
          },
        },
      });
    return route.fulfill({
      json: {
        id: groupId,
        name: "함께 운동",
        description: "",
        maxMembers: 5,
        currentMembers: 2,
        createdAt: date,
        members: [testUser.id, id(20)].map((userId, i) => ({
          userId,
          nickname: `친구${i}`,
          profileCharacter: null,
          streak: 0,
          role: i ? "member" : "leader",
          joinedAt: date,
        })),
      },
    });
  });
  await page.goto(`/groups/${groupId}`);
  const card = page.getByRole("region", { name: "그룹 해바라기 미션" });
  await expect(card.getByRole("img", { name: "줄기 단계" })).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute("value", "6");
  await expect(card.getByText("내가 준 물", { exact: false })).toHaveText(
    "내가 준 물 3회",
  );
  await expect(card.getByRole("list")).toHaveCount(0);
  await expect(
    card.getByText(/시작 인원|다음 룰렛까지|7회마다|완성까지/),
  ).toHaveCount(0);
  await card.getByRole("button", { name: "해바라기 미션 안내" }).click();
  const guide = page.getByRole("dialog", { name: "해바라기 미션 안내" });
  await expect(
    guide
      .getByRole("list", { name: "해바라기 성장 단계" })
      .getByRole("listitem"),
  ).toHaveCount(5);
  await expect(guide.getByText(/내가 준 물 7회마다 룰렛 1회/)).toBeVisible();
  await guide.getByRole("button", { name: "닫기" }).click();
  for (const width of [320, 390, 1218]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await card.screenshot({
      path: info.outputPath(`mission-card-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const next of phases) {
    phase = next;
    await page.reload();
    const image = card.getByRole("img", { name: `${phase.name} 단계` });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", new RegExp(`${phase.stage}\\.`));
    if (phase.stage === "seed")
      await expect(image).toHaveAttribute("src", "/icons/sunflower-seed.svg");
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "value",
      String(phase.water),
    );
    await card.screenshot({
      path: info.outputPath(`mission-${phase.stage}-390.png`),
    });
  }
  await expect(card.getByText("해바라기 완성!")).toBeVisible();
  await expect(
    card.getByRole("button", { name: "새 미션 시작" }),
  ).toBeVisible();
});
