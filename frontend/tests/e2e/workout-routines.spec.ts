import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { testUser } from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";
import type { WorkoutRoutine } from "../../lib/workout-routine";
import { installRoutine as setup } from "./workout-routine-fixtures";

for (const route of ["/", "/workout"])
  test(`${route}에서는 화면별 목록과 중단·완료 이력을 표시한다`, async ({
    page,
  }, info) => {
    const row = routineFixture();
    const state = await setup(page, row);
    const list = page.getByRole("list", { name: "오늘 배정된 운동" });
    const first = row.routine[0];
    for (const phase of [
      "new",
      "started",
      "interrupted",
      "next",
      "complete",
    ] as const) {
      if (phase !== "new") {
        first.status =
          phase === "started"
            ? "in_progress"
            : phase === "interrupted"
              ? "interrupted"
              : "completed";
        first.performedAt = row.serverTime;
        first.progress.watchedSeconds =
          phase === "started" ? 0 : phase === "interrupted" ? 20 : 60;
        first.progress.positionSeconds = first.progress.watchedSeconds;
        first.progress.intervals = first.progress.watchedSeconds
          ? [{ start: 0, end: first.progress.watchedSeconds }]
          : [];
        if (phase === "next" || phase === "complete") {
          first.completedAt = row.serverTime;
          first.resultStatus = "completed";
        }
        if (phase === "complete")
          for (const item of row.routine) {
            item.status = "completed";
            item.resultStatus = "completed";
            item.performedAt = item.completedAt = row.serverTime;
            item.progress = {
              durationSeconds: 60,
              watchedSeconds: 60,
              positionSeconds: 60,
              intervals: [{ start: 0, end: 60 }],
            };
          }
        row.progress.completedItems = row.routine.filter(
          (item) => item.status === "completed",
        ).length;
        row.status = phase === "complete" ? "completed" : "in_progress";
      }
      await page.goto(route);
      const cardio = page.getByRole("region", { name: "유산소 운동 안내" });
      if (route === "/workout") await expect(cardio).toContainText("걷기 20분");
      else await expect(cardio).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "앞 운동 완료 후 시작" }),
      ).toHaveCount(0);
      await expect(list.getByText(/휴식/)).toHaveCount(0);
      await expect(
        page.getByText(
          /첫 운동부터 시작|첫 운동 다시 보기|영상 운동을 마친 뒤 권장하는 활동이에요/,
        ),
      ).toHaveCount(0);
      if (phase === "complete") {
        await expect(list).toHaveCount(route === "/" ? 0 : 1);
        await expect(
          page.getByRole("link", { name: "오늘 운동 완료 확인" }),
        ).toHaveAttribute("href", `/workout-routines/${row.id}/complete`);
        await expect(
          page.getByText("오늘의 모든 운동을 완료했어요."),
        ).toBeVisible();
      } else {
        const current =
          row.routine[phase === "next" || phase === "interrupted" ? 1 : 0];
        await expect(list.getByRole("listitem")).toHaveCount(
          route === "/" ? 1 : 3,
        );
        await expect(list.getByRole("heading")).toHaveText(
          route === "/"
            ? [current.title]
            : row.routine.map((item) => item.title),
        );
        await expect(list.getByRole("link")).toHaveCount(
          route === "/workout" && phase === "interrupted" ? 2 : 1,
        );
        await expect(
          list.getByRole("link", {
            name: phase === "new" ? "운동 시작하기" : "운동 이어하기",
            exact: true,
          }),
        ).toHaveAttribute(
          "href",
          `/workout-routines/${row.id}/items/${current.id}`,
        );
      }
      if (phase === "next")
        await page.screenshot({
          path: info.outputPath("next-workout.png"),
          fullPage: true,
        });
    }
    expect(state.requests).toEqual([]);
    expect(state.events).toEqual([]);
  });

for (const cardio of [
  { activity: "걷기", minutes: 20 },
  { activity: "뛰기", minutes: 13 },
] as const)
  test(`영상 뒤 ${cardio.activity} ${cardio.minutes}분 안내를 생성·재조회·당일 재사용으로 보존한다`, async ({
    page,
  }) => {
    const generated = routineFixture();
    generated.cardioRecommendation = cardio;
    const state = await setup(page, null, generated);
    await page.goto("/workout");
    await expect(
      page.getByText("아직 오늘 배정된 운동이 없어요.", { exact: false }),
    ).toBeVisible();
    expect(state.requests).toHaveLength(0);
    await page
      .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
      .click();
    await expect(
      page
        .getByRole("list", { name: "오늘 배정된 운동" })
        .getByRole("listitem"),
    ).toHaveCount(3);
    await expect(
      page.getByRole("region", { name: "유산소 운동 안내" }),
    ).toContainText(`${cardio.activity} ${cardio.minutes}분`);
    const list = page.getByRole("list", { name: "오늘 배정된 운동" });
    const guidance = page.getByRole("region", { name: "유산소 운동 안내" });
    expect(
      await list.evaluate((list) => {
        const guidance = document.querySelector(
          '[aria-label="유산소 운동 안내"]',
        )!;
        return !!(
          list.compareDocumentPosition(guidance) &
          Node.DOCUMENT_POSITION_FOLLOWING
        );
      }),
    ).toBe(true);
    await expect(page.getByLabel("예상 운동 시간 6분")).toBeVisible();
    await expect(
      guidance.locator("button, input, video, progress"),
    ).toHaveCount(0);
    expect(state.events).toHaveLength(0);
    await expect(
      page.getByRole("button", { name: "오늘 운동 준비하기", exact: true }),
    ).toHaveCount(0);
    expect(state.requests).toHaveLength(1);
    await page.reload();
    await expect(
      page
        .getByRole("list", { name: "오늘 배정된 운동" })
        .getByRole("listitem"),
    ).toHaveCount(3);
    await expect(guidance).toContainText(
      `${cardio.activity} ${cardio.minutes}분`,
    );
    await page.evaluate(
      ({ owner, key }) => {
        sessionStorage.setItem(
          `modu-workout-journal:v1:${owner}:routine:today`,
          JSON.stringify([{ key, body: "{}" }]),
        );
      },
      { owner: testUser.id, key: crypto.randomUUID() },
    );
    await page.reload();
    await page.getByRole("button", { name: "이전 추천 요청 확인하기" }).click();
    await expect(
      page.getByRole("button", { name: "이전 추천 요청 확인하기" }),
    ).toHaveCount(0);
    await expect(guidance).toContainText(
      `${cardio.activity} ${cardio.minutes}분`,
    );
    expect(state.requests).toHaveLength(2);
    expect(state.row).toEqual(generated);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(guidance).toContainText(
      `${cardio.activity} ${cardio.minutes}분`,
    );
    expect(state.events).toHaveLength(0);
  });

for (const missing of [false, true])
  test(`유산소가 ${missing ? "누락된" : "null인"} 과거 응답은 안내 없이 현재 운동만 표시한다`, async ({
    page,
  }) => {
    const row = routineFixture();
    row.cardioRecommendation = null;
    if (missing) delete (row as Partial<WorkoutRoutine>).cardioRecommendation;
    const state = await setup(page, row);
    await page.goto("/workout");
    await expect(
      page
        .getByRole("list", { name: "오늘 배정된 운동" })
        .getByRole("listitem"),
    ).toHaveCount(3);
    await expect(
      page.getByRole("region", { name: "유산소 운동 안내" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page
        .getByRole("list", { name: "오늘 배정된 운동" })
        .getByRole("listitem"),
    ).toHaveCount(3);
    expect(state.requests).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

test("영상 항목만 완료한 루틴은 유산소 수행 없이 전체 완료로 표시한다", async ({
  page,
}) => {
  const row = routineFixture();
  for (const item of row.routine) {
    item.status = item.resultStatus = "completed";
    item.completedAt = item.performedAt = "2026-09-29T03:00:00Z";
    item.progress.watchedSeconds = item.progress.durationSeconds;
    item.progress.intervals = [
      { start: 0, end: item.progress.durationSeconds },
    ];
  }
  row.status = "completed";
  row.progress.completedItems = row.routine.length;
  const state = await setup(page, row);
  await page.goto("/workout");
  await expect(
    page.getByText("오늘의 모든 운동을 완료했어요.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }).getByRole("link"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "오늘 운동 완료 확인" }),
  ).toHaveAttribute("href", `/workout-routines/${row.id}/complete`);
  await expect(
    page.getByRole("region", { name: "유산소 운동 안내" }),
  ).toContainText("걷기 20분");
  expect(state.events).toHaveLength(0);
});

test("이전 버전의 미래 배정은 보존하되 오늘로 표시하거나 기록하지 않는다", async ({
  page,
}) => {
  const row = routineFixture();
  row.koreanDate = "2026-09-30";
  row.recordingAllowed = false;
  row.recordingExpiresAt = "2026-09-30T15:00:00.000Z";
  const state = await setup(page, row);
  await page.goto(`/workout-routines/${row.id}/items/${row.routine[0].id}`);
  await expect(page.getByText("2026-09-30에 시작할 운동이에요.")).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  expect(state.events).toHaveLength(0);
});

test("이전 next 미확정 요청은 원래 키로 확인하고 지난 배정을 오늘로 바꾸지 않는다", async ({
  page,
}) => {
  const state = await setup(page, null);
  const oldKey = "44444444-1111-4111-8111-111111111111";
  await page.addInitScript(
    ({ owner, key }) => {
      sessionStorage.setItem(
        `modu-workout-journal:v1:${owner}:routine:next`,
        JSON.stringify([{ key, body: "{}" }]),
      );
    },
    { owner: testUser.id, key: oldKey },
  );
  const keys: string[] = [];
  await page.route("**/api/v2/workout-routines/today", (route) => {
    const key = route.request().headers()["idempotency-key"];
    keys.push(key);
    if (key !== oldKey) return route.fallback();
    return route.fulfill({
      json: {
        ...routineFixture(),
        koreanDate: "2026-09-28",
        recordingAllowed: false,
        recordingExpiresAt: "2026-09-28T15:00:00Z",
      },
    });
  });
  await page.goto("/workout");
  await page.getByRole("button", { name: "이전 추천 요청 확인하기" }).click();
  await expect(
    page.getByText("이전 요청으로 준비한 2026-09-28 운동을 확인했어요.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }).getByRole("listitem"),
  ).toHaveCount(3);
  expect(keys[0]).toBe(oldKey);
  expect(keys[1]).not.toBe(oldKey);
  expect(state.requests).toHaveLength(1);
});

test("item playback reuses recovery, saves only the selected item and replays completed videos without events", async ({
  page,
}) => {
  const row = routineFixture();
  row.routine[0].playbackUrl =
    "https://openapi.kspo.or.kr/web/video/test-1.mp4";
  row.routine[0].playbackStatus = "verified";
  row.routine[0].verifiedDurationSeconds = 12;
  row.routine[0].progress.durationSeconds = 12;
  const state = await setup(page, row);
  await page.route(row.routine[0].playbackUrl, async (route) =>
    route.fulfill({
      contentType: "video/mp4",
      body: await readFile(path.resolve("tests/fixtures/workout.mp4")),
    }),
  );
  await page.goto("/workout");
  const list = page.getByRole("list", { name: "오늘 배정된 운동" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list).toContainText("10회 × 2세트");
  await expect(list.getByText(/휴식/)).toHaveCount(0);
  await list.getByRole("link", { name: "운동 시작하기" }).first().click();
  await page.getByRole("button", { name: "운동 시작", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "여기서 종료", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(9.6);
  await page.getByRole("button", { name: "여기서 종료", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(
    `/workout-routines/${row.id}/items/${row.routine[1].id}`,
  );
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(list.getByRole("heading")).toHaveText(
    row.routine.map((item) => item.title),
  );
  await expect(
    list.getByRole("link", { name: "운동 이어하기" }),
  ).toHaveAttribute(
    "href",
    `/workout-routines/${row.id}/items/${row.routine[1].id}`,
  );
  expect(state.events.every((event) => event.item === row.routine[0].id)).toBe(
    true,
  );
  expect(row.routine[1].status).toBe("assigned");
  await page.goto(
    `/account/workout-routines/${row.id}/items/${row.routine[0].id}/replay`,
  );
  await expect(
    page.getByRole("heading", { name: "운동 다시보기", exact: true }),
  ).toBeVisible();
  const before = state.events.length;
  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    void video.play();
  });
  await page.waitForTimeout(300);
  expect(state.events).toHaveLength(before);
  await expect(
    page.getByRole("link", { name: "운동 기록으로" }),
  ).toHaveAttribute("href", "/account/workouts/history/2026-09-29");
});

test("lost generation responses replay the same key across reload and readiness errors link to settings", async ({
  page,
}) => {
  const state = await setup(page, null);
  let fail = true;
  const keys: string[] = [];
  await page.route("**/api/v2/workout-routines/today", (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (fail) return route.abort();
    return route.fallback();
  });
  await page.goto("/workout");
  await page
    .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "이전 추천 요청 확인하기" }),
  ).toBeVisible();
  await page.reload();
  fail = false;
  await page.getByRole("button", { name: "이전 추천 요청 확인하기" }).click();
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }),
  ).toBeVisible();
  expect(keys[0]).toBe(keys[1]);
  expect(state.requests).toHaveLength(1);
  state.row = null;
  await page.route("**/api/v2/workout-routines/today", (route) =>
    route.fulfill({ status: 409, json: { code: "EXERCISE_GOAL_REQUIRED" } }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "운동 목적 선택하기" }),
  ).toHaveAttribute("href", "/account/preferences");
});

test("미완료 종료 확인을 취소하면 실제 일시정지를 저장하고 start로 재개한다", async ({
  page,
}) => {
  const row = routineFixture();
  row.routine[0].playbackStatus = "verified";
  row.routine[0].playbackUrl =
    "https://openapi.kspo.or.kr/web/video/confirmation-test.mp4";
  row.routine[0].verifiedDurationSeconds = 60;
  const state = await setup(page, row);
  await page.route(row.routine[0].playbackUrl, async (route) =>
    route.fulfill({
      contentType: "video/mp4",
      body: await readFile("tests/fixtures/workout.mp4"),
    }),
  );
  await page.goto(`/workout-routines/${row.id}/items/${row.routine[0].id}`);
  await page.getByRole("button", { name: "운동 시작", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "여기서 종료", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "이어서 운동하기" }),
  ).toBeEnabled();
  expect(state.events.map((event) => event.type)).toContain("pause");
  expect(state.events.map((event) => event.type)).not.toContain("complete");
  await page.getByRole("button", { name: "이어서 운동하기" }).click();
  await expect(
    page.getByRole("button", { name: "여기서 종료", exact: true }),
  ).toBeEnabled();
  expect(state.events.filter((event) => event.type === "start")).toHaveLength(
    2,
  );
});

test("legacy disconnection is visible but does not block new routines; invalid new responses remain errors", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "RECOMMENDATION_NOT_CONNECTED" },
    }),
  );
  await page.goto("/workout");
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(
    page.getByText(
      "이전 단일 운동 기록을 불러오지 못해 새 루틴 기록만 표시해요.",
    ),
  ).toBeVisible();
  await page.route("**/api/v2/workout-routines/current", (route) =>
    route.fulfill({ json: { routine: [] } }),
  );
  await page.reload();
  await expect(page.getByRole("alert").first()).toContainText(
    "서버 응답을 확인할 수 없어요",
  );
});

test("달력은 루틴 이력의 다음 페이지 실패를 복구하고 중복 기록 없이 상세를 연다", async ({
  page,
}) => {
  const row = routineFixture();
  row.status = "completed";
  row.progress.completedItems = row.routine.length;
  for (const item of row.routine) {
    item.status = "completed";
    item.resultStatus = "completed";
    item.completedAt = "2026-09-29T03:00:00.000Z";
  }
  await setup(page, row);
  let fail = true;
  const cursors: string[] = [];
  await page.route("**/api/v2/workout-routines/history?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor)
      return route.fulfill({ json: { items: [row], nextCursor: row.id } });
    cursors.push(cursor);
    if (fail)
      return route.fulfill({ status: 503, json: { message: "unavailable" } });
    return route.fulfill({
      json: {
        items: [
          row,
          {
            ...row,
            id: "99999999-1111-4111-8111-111111111111",
            koreanDate: "2026-09-28",
            recordingAllowed: false,
            recordingExpiresAt: "2026-09-28T15:00:00.000Z",
            routine: row.routine.map((item) => ({
              ...item,
              completedAt: "2026-09-28T03:00:00.000Z",
            })),
          },
        ],
        nextCursor: null,
      },
    });
  });
  await page.goto("/workout");
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await expect(calendar.getByRole("alert")).toBeVisible();
  await expect(calendar.getByRole("link")).toHaveCount(0);
  fail = false;
  await calendar
    .getByRole("button", { name: "운동 기록 다시 불러오기" })
    .click();
  await expect(calendar.getByText("2일 운동했어요")).toBeVisible();
  expect(cursors.length).toBeGreaterThanOrEqual(2);
  expect(cursors.every((cursor) => cursor === row.id)).toBe(true);
  await calendar
    .getByRole("link", { name: "9월 29일 오늘, 운동함", exact: true })
    .click();
  const records = page.getByRole("list", { name: "선택한 날짜의 운동 기록" });
  await expect(records.getByRole("listitem")).toHaveCount(3);
  await records.getByRole("link").first().click();
  await expect(page).toHaveURL(
    `/workout-routines/${row.id}/items/${row.routine[0].id}/replay`,
  );
  await expect(
    page.getByRole("heading", { name: "운동 다시보기", exact: true }),
  ).toBeVisible();
});

for (const pendingPause of [false, true]) {
  test(`영상의 기본 재생 버튼은 ${pendingPause ? "일시정지 저장 중에도" : "중단 저장 후에도"} 다시 재생하고 기록한다`, async ({
    page,
  }) => {
    const row = routineFixture();
    const item = row.routine[0];
    item.playbackUrl =
      "https://openapi.kspo.or.kr/web/video/native-controls.mp4";
    item.playbackStatus = "verified";
    item.verifiedDurationSeconds = item.progress.durationSeconds = 12;
    const state = await setup(page, row);
    await page.route(item.playbackUrl, async (route) =>
      route.fulfill({
        contentType: "video/mp4",
        body: await readFile(path.resolve("tests/fixtures/workout.mp4")),
      }),
    );
    let releasePause: (() => void) | undefined;
    const delay = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    if (pendingPause)
      await page.route(
        "**/api/v2/workout-routines/**/events",
        async (route) => {
          if (route.request().postDataJSON().type === "pause") await delay;
          await route.fallback();
        },
      );
    await page.goto(`/workout-routines/${row.id}/items/${item.id}`);
    const video = page.getByLabel("운동 영상");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    await expect(video).toHaveAttribute("controls", "");
    // Native media gestures fire the same play/pause events as the video controls.
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await expect.poll(() => item.status).toBe("in_progress");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(1);
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    if (!pendingPause) await expect.poll(() => item.status).toBe("interrupted");
    await expect(video).toHaveAttribute("controls", "");
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    await video.evaluate((v: HTMLVideoElement) => v.play());
    releasePause?.();
    await expect
      .poll(() => state.events.map((event) => event.type).slice(0, 3))
      .toEqual(["start", "pause", "start"]);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(before + 1);
    await expect(
      page.getByRole("button", { name: "이어서 운동하기" }),
    ).toHaveCount(0);
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    await expect.poll(() => item.progress.watchedSeconds).toBeGreaterThan(2);
    await expect.poll(() => item.status).toBe("interrupted");
  });
}

test("기본 재생의 시작 저장 중 일시정지해도 시작 뒤 정지와 실제 시청 구간을 저장한다", async ({
  page,
}) => {
  const row = routineFixture(),
    item = row.routine[0];
  item.playbackUrl = "https://openapi.kspo.or.kr/web/video/native-start.mp4";
  item.playbackStatus = "verified";
  item.verifiedDurationSeconds = item.progress.durationSeconds = 12;
  const state = await setup(page, row);
  await page.route(item.playbackUrl, async (route) =>
    route.fulfill({
      contentType: "video/mp4",
      body: await readFile(path.resolve("tests/fixtures/workout.mp4")),
    }),
  );
  let releaseStart!: () => void;
  const delay = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  await page.route("**/api/v2/workout-routines/**/events", async (route) => {
    if (route.request().postDataJSON().type === "start") await delay;
    await route.fallback();
  });
  await page.goto(`/workout-routines/${row.id}/items/${item.id}`);
  const video = page.getByLabel("운동 영상");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.5);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  releaseStart();
  await expect
    .poll(() => state.events.map((event) => event.type))
    .toEqual(["start", "pause"]);
  await expect.poll(() => item.status).toBe("interrupted");
  expect(item.progress.watchedSeconds).toBeGreaterThan(0.5);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
});
