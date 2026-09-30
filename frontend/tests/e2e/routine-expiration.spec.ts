import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installApi, testRecord } from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";
import type { WorkoutRoutine } from "../../lib/workout-routine";

async function setup(page: Page, row: WorkoutRoutine) {
  await installApi(page, testRecord());
  const state = { row, posts: 0, reads: 0, reject: false };
  const item = row.routine[0];
  item.playbackStatus = "verified";
  item.playbackUrl = "https://openapi.kspo.or.kr/web/video/expiration-test.mp4";
  item.verifiedDurationSeconds = 60;
  await page.route(item.playbackUrl, async (route) =>
    route.fulfill({
      contentType: "video/mp4",
      body: await readFile("tests/fixtures/workout.mp4"),
    }),
  );
  await page.route("**/api/v2/workout-routines/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/history"))
      return route.fulfill({ json: { items: [state.row], nextCursor: null } });
    if (route.request().method() === "POST") {
      state.posts++;
      return state.reject
        ? route.fulfill({ status: 409, json: { code: "ROUTINE_EXPIRED" } })
        : route.fulfill({ json: state.row });
    }
    state.reads++;
    return route.fulfill({ json: state.row });
  });
  return state;
}

for (const status of [
  "assigned",
  "in_progress",
  "not_performed",
  "interrupted",
  "completed",
] as const) {
  test(`지난 ${status} 루틴은 재생·탐색·이탈 시 기록 없이 시청한다`, async ({
    page,
  }) => {
    const row = routineFixture();
    row.serverKoreanDate = "2026-09-30";
    row.serverTime = "2026-09-30T03:00:00Z";
    row.recordingAllowed = false;
    row.routine[0].status = status;
    if (status === "completed") {
      row.routine[0].resultStatus = "completed";
      row.routine[0].completedAt = "2026-09-29T03:00:00Z";
      row.progress.completedItems = 1;
    }
    const state = await setup(page, row);
    await page.goto(
      `/account/workout-routines/${row.id}/items/${row.routine[0].id}/replay`,
    );
    await expect(
      page.getByText("지난 루틴의 시청은 운동 기록에 반영되지 않습니다."),
    ).toBeVisible();
    const video = page.locator("video");
    await expect(video).toHaveAttribute("controls");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(0.2);
    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = 3;
      v.dispatchEvent(new Event("timeupdate"));
      v.pause();
      v.dispatchEvent(new Event("ended"));
    });
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.getByRole("link", { name: "운동 기록으로" }).click();
    await expect(page).toHaveURL("/account/workouts");
    expect(state.posts).toBe(0);
    expect(state.row.routine[0].revision).toBe(1);
    await expect(
      page.getByRole("link", { name: "운동 영상 보기" }).first(),
    ).toBeVisible();
  });
}

test("재생 중 서버 마감 시각에 기록만 멈추고 영상과 위치를 유지한다", async ({
  page,
}) => {
  const row = routineFixture();
  row.routine[0].status = "in_progress";
  row.serverTime = "2026-09-29T14:59:58Z";
  const state = await setup(page, row);
  await page.clock.install({ time: new Date("2001-01-01T00:00:00Z") });
  await page.goto(`/workout-routines/${row.id}/items/${row.routine[0].id}`);
  const video = page.locator("video");
  await expect(video).toHaveAttribute("controls");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  const before = state.posts;
  await page.clock.fastForward(2500);
  await expect(
    page.getByText("지난 루틴의 시청은 운동 기록에 반영되지 않습니다."),
  ).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await expect(
    page.getByRole("button", { name: "운동 완료", exact: true }),
  ).toHaveCount(0);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 6;
    v.dispatchEvent(new Event("timeupdate"));
    v.pause();
  });
  expect(state.posts).toBe(before);
});

test("409 만료는 큐 복구를 종료하고 같은 revision의 GET으로 날짜를 확인한다", async ({
  page,
}) => {
  const row = routineFixture();
  row.routine[0].status = "in_progress";
  const state = await setup(page, row);
  await page.goto(`/workout-routines/${row.id}/items/${row.routine[0].id}`);
  const video = page.locator("video");
  await expect(video).toHaveAttribute("controls");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  state.reject = true;
  const before = state.posts;
  state.row = {
    ...row,
    serverKoreanDate: "2026-09-30",
    serverTime: "2026-09-29T15:00:00Z",
    recordingAllowed: false,
  };
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.2);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await expect(
    page.getByText("지난 루틴의 시청은 운동 기록에 반영되지 않습니다."),
  ).toBeVisible();
  expect(state.posts).toBe(before + 1);
  expect(state.reads).toBeGreaterThan(1);
  await expect(
    page.getByRole("button", { name: "저장 다시 확인하기" }),
  ).toHaveCount(0);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 4;
    return v.play();
  });
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  expect(state.posts).toBe(before + 1);
});

test("백그라운드 마감 타이머가 지연돼도 이탈 경로는 영상을 멈추거나 기록하지 않는다", async ({
  page,
}) => {
  const row = routineFixture();
  row.routine[0].status = "in_progress";
  const state = await setup(page, row);
  await page.goto(`/workout-routines/${row.id}/items/${row.routine[0].id}`);
  const video = page.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.2);
  const before = state.posts;
  // Simulate a suspended tab's elapsed monotonic clock before its timeout callback runs.
  await page.evaluate(() => {
    const afterMidnight = performance.now() + 12 * 3600000 + 1000;
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => afterMidnight,
    });
    window.dispatchEvent(new Event("pagehide"));
  });
  await expect(
    page.getByText("지난 루틴의 시청은 운동 기록에 반영되지 않습니다."),
  ).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  expect(state.posts).toBe(before);
});
