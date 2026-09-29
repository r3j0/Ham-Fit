import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { installApi, testRecord } from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";
import type { WorkoutRoutine } from "../../lib/workout-routine";
async function setup(
  page: Page,
  row: WorkoutRoutine | null = routineFixture(),
) {
  await installApi(page, testRecord());
  const state = {
    row,
    requests: [] as { key: string; body: string }[],
    events: [] as { item: string; key: string; type: string }[],
  };
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/v1/workout-routines/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const row = state.row;
    if (url.pathname.endsWith("/current"))
      return route.fulfill({
        json: row && row.koreanDate <= row.serverKoreanDate ? row : null,
      });
    if (url.pathname.endsWith("/history"))
      return route.fulfill({
        json: { items: row ? [row] : [], nextCursor: null },
      });
    if (url.pathname.endsWith("/next")) {
      state.requests.push({
        key: req.headers()["idempotency-key"],
        body: req.postData()!,
      });
      expect(req.headers()["x-csrf-protection"]).toBe("1");
      state.row = {
        ...routineFixture(),
        koreanDate: "2026-09-30",
        referenceDate: "2026-09-29",
      };
      return route.fulfill({ status: 201, json: state.row });
    }
    if (url.pathname.endsWith("/events") && row) {
      const itemId = url.pathname.split("/").at(-2)!;
      const item = row.routine.find((item) => item.id === itemId)!;
      const body = req.postDataJSON();
      state.events.push({
        item: itemId,
        key: req.headers()["idempotency-key"],
        type: body.type,
      });
      expect(req.headers()["x-csrf-protection"]).toBe("1");
      item.revision++;
      item.status = body.type === "complete" ? "completed" : "in_progress";
      if (body.type === "complete") {
        item.resultStatus = "completed";
        item.completedAt = "2026-09-29T03:00:00Z";
      }
      item.performedAt = "2026-09-29T03:00:00Z";
      row.progress.completedItems = row.routine.filter(
        (i) => i.status === "completed",
      ).length;
      row.status =
        row.progress.completedItems === row.routine.length
          ? "completed"
          : "in_progress";
      return route.fulfill({ json: row });
    }
    return route.fulfill({ json: row });
  });
  return state;
}

test("shows every prescribed item and keeps tomorrow separate with an explicit, durable generation request", async ({
  page,
}) => {
  const state = await setup(page, null);
  await page.goto("/workout");
  await expect(
    page.getByText("아직 오늘 배정된 운동이 없어요.", { exact: false }),
  ).toBeVisible();
  expect(state.requests).toHaveLength(0);
  await page
    .getByRole("button", { name: "내일 운동 준비하기", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "내일의 운동" })).toContainText(
    "2026-09-30",
  );
  await expect(
    page.getByRole("list", { name: "오늘 배정된 운동" }),
  ).toHaveCount(0);
  expect(state.requests).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("region", { name: "내일의 운동" })).toBeVisible();
  await page.goto(
    `/workout-routines/${state.row!.id}/items/${state.row!.routine[0].id}`,
  );
  await expect(page.getByText("2026-09-30에 시작할 운동이에요.")).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  expect(state.events).toHaveLength(0);
});

test("item playback reuses recovery, saves only the selected item and replays completed videos without events", async ({
  page,
}) => {
  const row = routineFixture();
  row.routine[0].playbackUrl =
    "https://openapi.kspo.or.kr/web/video/test-1.mp4";
  row.routine[0].playbackStatus = "verified";
  row.routine[0].verifiedDurationSeconds = 60;
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
  await expect(list).toContainText("10회 반복 · 2세트 · 휴식 30초");
  await list.getByRole("link", { name: "운동 시작하기" }).first().click();
  await page.getByRole("button", { name: "운동 시작", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "운동 완료", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "운동 완료", exact: true }).click();
  await page.getByRole("button", { name: "완료 확인", exact: true }).click();
  await page.getByRole("link", { name: "운동 목록으로" }).click();
  await expect(list.getByText("완료", { exact: true })).toHaveCount(1);
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
  await page.route("**/api/v1/workout-routines/next", (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (fail) return route.abort();
    return route.fallback();
  });
  await page.goto("/workout");
  await page
    .getByRole("button", { name: "내일 운동 준비하기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "이전 추천 요청 확인하기" }),
  ).toBeVisible();
  await page.reload();
  fail = false;
  await page.getByRole("button", { name: "이전 추천 요청 확인하기" }).click();
  await expect(page.getByRole("region", { name: "내일의 운동" })).toBeVisible();
  expect(keys[0]).toBe(keys[1]);
  expect(state.requests).toHaveLength(1);
  state.row = null;
  await page.route("**/api/v1/workout-routines/next", (route) =>
    route.fulfill({ status: 409, json: { code: "EXERCISE_GOAL_REQUIRED" } }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "내일 운동 준비하기", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "운동 목적 선택하기" }),
  ).toHaveAttribute("href", "/account/preferences");
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
  await page.route("**/api/v1/workout-routines/current", (route) =>
    route.fulfill({ json: { routine: [] } }),
  );
  await page.reload();
  await expect(page.getByRole("alert").first()).toContainText(
    "서버 응답을 확인할 수 없어요",
  );
});

test("두 기록 API의 페이지를 보존하고 실패한 커서만 재시도한다", async ({
  page,
}) => {
  const row = routineFixture();
  await setup(page, row);
  let fail = true;
  const cursors: string[] = [];
  await page.route("**/api/v1/workout-routines/history?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor)
      return route.fulfill({ json: { items: [row], nextCursor: row.id } });
    cursors.push(cursor);
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { message: "unavailable" } });
    }
    return route.fulfill({
      json: {
        items: [
          row,
          {
            ...row,
            id: "99999999-1111-4111-8111-111111111111",
            koreanDate: "2026-09-28",
          },
        ],
        nextCursor: null,
      },
    });
  });
  await page.goto("/account/workouts");
  await expect(page.locator(".workout-list > li")).toHaveCount(3);
  await page.getByRole("button", { name: "이전 운동 더 보기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.locator(".workout-list > li")).toHaveCount(3);
  await page.getByRole("button", { name: "이전 운동 더 보기" }).click();
  await expect(page.locator(".workout-list > li")).toHaveCount(6);
  expect(cursors).toEqual([row.id, row.id]);
});
