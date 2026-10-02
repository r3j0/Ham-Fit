import { expect, test, type Page } from "@playwright/test";
import {
  installApi,
  testRecord,
  testUser,
  testOutfit,
  testWorkout,
} from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";

async function setup(page: Page) {
  await installApi(page, testRecord());
  await page.clock.setFixedTime(new Date("2026-09-29T03:00:00Z"));
  const routine = routineFixture();
  routine.status = "completed";
  routine.progress.completedItems = routine.routine.length;
  for (const item of routine.routine) {
    item.status = item.resultStatus = "completed";
    item.completedAt = item.performedAt = routine.serverTime;
  }
  const previous = structuredClone(routine);
  previous.id = "20000000-0000-4000-8000-000000000099";
  previous.koreanDate = "2026-09-27";
  previous.recordingAllowed = false;
  previous.recordingExpiresAt = "2026-09-27T15:00:00Z";
  previous.routine.forEach(
    (item) => (item.completedAt = item.performedAt = "2026-09-27T03:00:00Z"),
  );
  const state = {
    historyError: false,
    routines: [previous, routine],
    historyRequests: [] as string[],
  };
  await page.route("**/api/v2/workout-routines/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/history")) {
      state.historyRequests.push(url.search);
      return state.historyError
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({
            json: {
              items: state.routines,
              nextCursor: null,
              serverKoreanDate: routine.serverKoreanDate,
            },
          });
    }
    return route.fulfill({ json: routine });
  });
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...testWorkout,
            status: "completed",
            completedAt: "2026-09-28T03:00:00Z",
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route("**/api/v1/users/me/profile/activity", (route) =>
    route.fulfill({
      json: {
        userId: testUser.id,
        nickname: "햄콩이",
        profileCharacter: null,
        streak: 3,
      },
    }),
  );
  await page.route("**/api/v1/users/me/avatar/outfit", (route) =>
    route.fulfill({
      json: {
        ...testOutfit,
        characterId: "character.gray",
        rendering: { ...testOutfit.rendering, variant: "gray" },
      },
    }),
  );
  await page.route("**/api/v1/users/me/activity-rewards?*", (route) =>
    route.fulfill({
      json: {
        routineId: routine.id,
        koreanDate: routine.koreanDate,
        seed: { status: "not_eligible", amount: 0, transactionId: null },
        waters: [],
        personalTicketIds: [],
      },
    }),
  );
  await page.route("**/api/v1/users/me/group-mission-water**", (route) =>
    route.fulfill({
      json: {
        sourceKind: "routine",
        sourceId: routine.id,
        koreanDate: routine.koreanDate,
        status: "contributed",
        reason: null,
        options: [],
        contribution: {
          groupId: "30000000-0000-4000-8000-000000000001",
          groupName: "함께 운동",
          roundId: "30000000-0000-4000-8000-000000000002",
          amount: 1,
        },
      },
    }),
  );
  return { routine, state, base: `/workout-routines/${routine.id}/complete` };
}

async function pauseCelebrations(page: Page) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.hasAttribute("data-completion-motion")) animation.pause();
      return animation;
    };
  });
}
async function finish(page: Page, kind: "jump" | "sunflower") {
  const motion = page.locator(`[data-completion-motion="${kind}"]`);
  await expect
    .poll(() => motion.evaluate((el) => el.getAnimations().length))
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "다음", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toHaveCount(0);
  await motion.evaluate((el) => el.getAnimations()[0].finish());
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toBeVisible();
}

test("점프와 오늘 해바라기가 끝나야 다음으로 이동하며 실제 7일 기록과 내 햄스터를 표시한다", async ({
  page,
}) => {
  const { base, state } = await setup(page);
  await pauseCelebrations(page);
  await page.goto(base);
  await finish(page, "jump");
  await page.getByRole("link", { name: "다음", exact: true }).click();
  const mascot = page.getByRole("img", {
    name: "연속 운동을 응원하는 내 햄스터",
  });
  await expect(mascot).toHaveAttribute("data-pose", "passion");
  await expect(mascot).toHaveAttribute("data-variant", "gray");
  const week = page.getByRole("list", { name: "최근 7일 운동 기록" });
  await expect(week.getByRole("listitem")).toHaveCount(7);
  await expect(week.getByLabel("9월 26일, 완료 기록 없음")).toBeVisible();
  await expect(
    week.getByLabel("9월 27일, 운동 루틴 완료").locator("img"),
  ).toHaveAttribute("src", /sunflower/);
  await expect(
    week.getByLabel("9월 28일, 운동 영상 완료").locator("img"),
  ).toHaveAttribute("src", /sunflower-seed/);
  await expect(
    week
      .getByLabel("9월 29일 오늘, 운동 루틴 완료")
      .locator("[data-completion-motion]"),
  ).toHaveAttribute("data-completion-motion", "sunflower");
  expect(new Set(state.historyRequests).size).toBe(1);
  expect(new URLSearchParams(state.historyRequests[0]).get("from")).toBe(
    "2026-09-23",
  );
  expect(new URLSearchParams(state.historyRequests[0]).get("to")).toBe(
    "2026-09-29",
  );
  await finish(page, "sunflower");
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(`${base}/water`);
});

test("동작 줄이기는 대기 없이 진행하고 모바일·데스크톱에서 기록이 넘치지 않는다", async ({
  page,
}, info) => {
  const { base } = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base);
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('[data-completion-motion="jump"]')
        .evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await page.screenshot({
    path: info.outputPath("completion-jump-rest.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toBeVisible();
  const flower = page.locator('[data-completion-motion="sunflower"]');
  await expect(flower).toHaveCSS("opacity", "1");
  expect(await flower.evaluate((el) => el.getAnimations().length)).toBe(0);
  await expect(
    page.getByRole("img", { name: "연속 운동을 응원하는 내 햄스터" }),
  ).toHaveAttribute("data-variant", "gray");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`completion-streak-${width}.png`),
      fullPage: true,
    });
  }
});

test("이력 반영이 늦어도 방금 완료한 오늘 루틴을 표시하고 동작 줄이기 전환으로 대기를 해제한다", async ({
  page,
}) => {
  const { base, state } = await setup(page);
  state.routines = [];
  await pauseCelebrations(page);
  await page.goto(`${base}/streak`);
  await expect(page.getByLabel("9월 29일 오늘, 운동 루틴 완료")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('[data-completion-motion="sunflower"]')
        .evaluate((el) => el.getAnimations().length),
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "다음", exact: true }),
  ).toBeDisabled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toBeVisible();
});

test("기록 조회 실패는 재시도할 수 있으며 복구 후 해바라기 애니메이션을 기다린다", async ({
  page,
}) => {
  const { base, state } = await setup(page);
  state.historyError = true;
  await pauseCelebrations(page);
  await page.goto(`${base}/streak`);
  await expect(
    page.getByText("운동 기록을 불러오지 못했어요. 다시 확인해 주세요."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toBeVisible();
  state.historyError = false;
  await page.getByRole("button", { name: "운동 기록 다시 불러오기" }).click();
  await finish(page, "sunflower");
});

test("과거 완료 화면은 오늘 칸에 새로운 해바라기를 추가하지 않는다", async ({
  page,
}) => {
  const { base, routine, state } = await setup(page);
  routine.serverKoreanDate = "2026-09-30";
  routine.serverTime = "2026-09-30T03:00:00Z";
  routine.recordingAllowed = false;
  state.routines = [routine];
  await pauseCelebrations(page);
  await page.goto(`${base}/streak`);
  await expect(page.getByLabel("9월 30일 오늘, 완료 기록 없음")).toBeVisible();
  await expect(
    page.locator('[data-completion-motion="sunflower"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toBeVisible();
});

test("실제 재생이 끝나면 다음이 활성화되고 뒤로가기 복원 시 완료 상태를 유지한다", async ({
  page,
}) => {
  const { base } = await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${base}/streak`);
  const flower = page.locator('[data-completion-motion="sunflower"]');
  await expect(
    page.getByRole("button", { name: "다음", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toBeVisible();
  await expect(flower).toHaveCSS("opacity", "1");
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(`${base}/water`);
  await page.goBack();
  await expect(page).toHaveURL(`${base}/streak`);
  await expect(
    page.getByRole("link", { name: "다음", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      flower.evaluate(
        (el) =>
          el
            .getAnimations()
            .filter((animation) => animation.playState !== "finished").length,
      ),
    )
    .toBe(0);
});
