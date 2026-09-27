import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { PlaybackEvent, Workout } from "../../lib/workout-types";
import { installApi, testRecord, testWorkout } from "./integration-fixtures";
const base = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "frontend-workout-test-password-2026!";
async function waitForLimit(
  page: Page,
  response:
    | import("@playwright/test").APIResponse
    | import("@playwright/test").Response,
) {
  const body = await response.json();
  await page.waitForTimeout(
    Math.min(60, Number(body.retry_after) || 60) * 1000,
  );
}
async function openAuthenticated(page: Page, url?: string) {
  const refreshed = page.waitForResponse((r) =>
    r.url().endsWith("/auth/refresh"),
  );
  if (url) await page.goto(url);
  else await page.reload();
  const response = await refreshed;
  if (response.status() === 429) {
    await waitForLimit(page, response);
    const retry = page.waitForResponse((r) =>
      r.url().endsWith("/auth/refresh"),
    );
    await page.getByRole("button", { name: "다시 연결하기" }).click();
    expect((await retry).status()).toBe(200);
  } else expect(response.status()).toBe(200);
}
async function registerTestUser(page: Page, data: Record<string, string>) {
  const send = () =>
    page.request.post(`${base}/auth/register`, {
      headers: { "X-CSRF-Protection": "1" },
      data,
    });
  let response = await send();
  if (response.status() === 429) {
    await waitForLimit(page, response);
    response = await send();
  }
  return response;
}
async function saveBirthProfile(page: Page) {
  const send = async () => {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/users/me/profile") &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "생년월일 저장" }).click();
    return response;
  };
  let response = await send();
  if (response.status() === 429) {
    await waitForLimit(page, response);
    response = await send();
  }
  expect(response.status()).toBe(200);
  await expect(page.getByText("생년월일을 저장했어요.")).toBeVisible();
}
async function prepare(page: Page) {
  const response = await registerTestUser(page, {
    email: `workout-e2e-${crypto.randomUUID()}@example.test`,
    password,
    dateOfBirth: "2000-02-29",
  });
  expect(response.status()).toBe(201);
  const auth = await response.json();
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const catalog = await (
    await page.request.get(`${base}/measurement-catalog`)
  ).json();
  const record = await page.request.post(`${base}/measurements`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      measuredOn: "2026-09-17",
      ageAtMeasurement: 26,
      sexAtMeasurement: null,
      reportKind: "standard",
      centerName: null,
      reportedOverallGrade: null,
      catalogVersion: catalog.version,
      items: [
        {
          measurementCode: "height",
          value: "170",
          unit: "cm",
          reportedGrade: null,
        },
      ],
    },
  });
  expect(record.status()).toBe(201);
  const assigned = await page.request.post(`${base}/workouts/today`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
  expect(assigned.status()).toBe(201);
  const workout = (await assigned.json()) as Workout;
  const read = async () =>
    (await (
      await page.request.get(`${base}/workouts/${workout.id}`, { headers })
    ).json()) as Workout;
  return { workout, read, headers, email: auth.user.email as string };
}
async function serveTestMedia(page: Page) {
  const url = new URL(
    "/test-workout.mp4",
    process.env.E2E_BASE_URL ?? "http://localhost:3000",
  ).href;
  const bytes = await readFile(path.resolve("tests/fixtures/workout.mp4"));
  await page.route(url, (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(
      route.request().headers().range ?? "",
    );
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      body: bytes.subarray(start, end + 1),
      contentType: "video/mp4",
      headers: {
        "Accept-Ranges": "bytes",
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` }
          : {}),
      },
    });
  });
  return url;
}
// Real API tests replace only media delivery with a tiny generated MP4.
async function testMedia(page: Page, workout: Workout) {
  const url = await serveTestMedia(page);
  await page.route(
    new RegExp(`/api/v1/workouts/(?:${workout.id}|current)$`),
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({
        response,
        json: {
          ...data,
          video: {
            ...data.video,
            playbackStatus: "verified",
            playbackUrl: url,
          },
        },
      });
    },
  );
  // Event replies also carry video metadata; retain the same media fixture across state updates.
  await page.route(`**/api/v1/workouts/${workout.id}/events`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: data.video
        ? {
            ...data,
            video: {
              ...data.video,
              playbackStatus: "verified",
              playbackUrl: url,
            },
          }
        : data,
    });
  });
}
test("actual playback excludes seeks, ends below 50%, resumes after reload and completes only on confirmation", async ({
  page,
}, info) => {
  const { workout, read } = await prepare(page);
  await testMedia(page, workout);
  await openAuthenticated(page, "/");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "운동", exact: true })
    .click();
  await expect(page).toHaveURL("/workout");
  await expect(page.locator("video")).toHaveCount(0);
  await page.getByRole("link", { name: "운동 시작하기", exact: true }).click();
  await expect(page).toHaveURL(`/workouts/${workout.id}`);
  const video = page.getByLabel("운동 영상");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "운동 시작", exact: true }).click();
  await expect(video).toHaveAttribute("controls");
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(1);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 6;
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(7);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await expect
    .poll(async () => (await read()).progress.watchedSeconds)
    .toBeGreaterThan(1);
  await expect
    .poll(async () =>
      (await read()).progress.intervals.some((r) => r.start >= 5),
    )
    .toBe(true);
  const progress = (await read()).progress;
  expect(progress.watchedSeconds).toBeLessThan(5);
  expect(progress.intervals.some((r) => r.start >= 5)).toBeTruthy();
  await page.getByRole("button", { name: "여기서 종료" }).click();
  await page.getByRole("button", { name: "종료 확인" }).click();
  await expect.poll(async () => (await read()).status).toBe("not_performed");
  await openAuthenticated(page);
  await expect(
    page.getByRole("button", { name: "이어서 운동하기" }),
  ).toBeEnabled();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(6);
  await page.getByRole("button", { name: "이어서 운동하기" }).click();
  await expect(video).toHaveAttribute("controls");
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 11.8;
    return v.play();
  });
  await expect(
    page.getByText("영상이 끝났어요.", { exact: false }),
  ).toBeVisible();
  expect((await read()).status).toBe("in_progress");
  await page.getByRole("button", { name: "운동 완료", exact: true }).click();
  expect((await read()).status).toBe("in_progress");
  await page.getByRole("button", { name: "완료 확인" }).click();
  await expect.poll(async () => (await read()).status).toBe("completed");
  await expect(video).toHaveAttribute("controls");
  const completed = await read();
  let replayEvents = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(`/workouts/${workout.id}/events`))
      replayEvents++;
  });
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 0;
    return v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(1);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  expect((await read()).revision).toBe(completed.revision);
  expect((await read()).progress).toEqual(completed.progress);
  expect(replayEvents).toBe(0);
  await page.screenshot({
    path: info.outputPath("completed-workout.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "운동 목록으로", exact: true }).click();
  await expect(page).toHaveURL("/workout");
  await expect(
    page
      .getByRole("region", { name: "운동 기록", exact: true })
      .locator('a[aria-current="date"]'),
  ).toHaveAttribute("data-completed", "true");
  await expect(
    page
      .getByRole("list", { name: "오늘 배정된 운동" })
      .getByText("완료", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "오늘 운동 추천받기" }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "운동 스트릭" })).toContainText(
    "1일 연속 운동 중",
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "내 프로필", exact: true })
    .click();
  await page.getByRole("link", { name: "내 운동 이력", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "운동 다시보기" }),
  ).toHaveAttribute("href", `/workouts/${workout.id}/replay`);
  await expect(page.getByText("최근 수행일", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "운동 다시보기" }).click();
  await expect(
    page.getByText("운동을 완료했어요.", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(`/workouts/${workout.id}/replay`);
  await expect(
    page.getByRole("heading", { name: "운동 다시보기", exact: true }),
  ).toBeVisible();
  await expect(video).toHaveAttribute("controls");
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(1);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  expect((await read()).revision).toBe(completed.revision);
  expect((await read()).progress).toEqual(completed.progress);
  expect(replayEvents).toBe(0);
  await page.getByRole("link", { name: "운동 기록으로", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "운동 기록 상세", exact: true }),
  ).toBeVisible();
  const dailyRecords = page.getByRole("list", {
    name: "선택한 날짜의 운동 기록",
  });
  await expect(dailyRecords.getByRole("listitem")).toHaveCount(1);
  await expect(dailyRecords.getByRole("link")).toHaveAttribute(
    "href",
    `/workouts/${workout.id}/replay`,
  );
});
test("a lost start response survives reload with the original event key and body", async ({
  page,
}) => {
  const { workout, read } = await prepare(page);
  await testMedia(page, workout);
  const requests: { key: string; body: string | null }[] = [];
  let lost = false;
  await page.route(`**/api/v1/workouts/${workout.id}/events`, async (route) => {
    if (route.request().postDataJSON().type !== "start")
      return route.fallback();
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.fallback();
  });
  await openAuthenticated(page, `/workouts/${workout.id}`);
  await page.getByRole("button", { name: "운동 시작", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "저장 다시 확인하기" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await openAuthenticated(page);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]).toEqual(requests[1]);
  await expect(
    page.getByRole("button", { name: "운동 완료", exact: true }),
  ).toBeEnabled();
  expect((await read()).revision).toBeGreaterThanOrEqual(2);
});
test("unavailable media has an explicit retry and never uses originalUrl", async ({
  page,
}) => {
  const { workout } = await prepare(page);
  await page.route(`**/api/v1/workouts/${workout.id}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        video: {
          ...data.video,
          playbackStatus: "unavailable",
          playbackUrl: null,
        },
      },
    });
  });
  await openAuthenticated(page, `/workouts/${workout.id}`);
  await expect(
    page.getByText("현재 이 영상을 재생할 수 없어요.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "저장된 운동 상태 확인" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "운동 시작", exact: true }),
  ).toHaveCount(0);
});

test("a saved 50% session ends as interrupted and can be explicitly completed after resuming", async ({
  page,
}) => {
  const { workout, headers, read } = await prepare(page);
  const deviceId = crypto.randomUUID();
  for (const [sequence, type, intervals, positionSeconds] of [
    [1, "start", [], 0],
    [
      2,
      "progress",
      [{ start: 0, end: workout.video.durationSeconds / 2 }],
      workout.video.durationSeconds / 2,
    ],
  ] as const) {
    const saved = await page.request.post(
      `${base}/workouts/${workout.id}/events`,
      {
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        data: { type, deviceId, sequence, intervals, positionSeconds },
      },
    );
    expect(saved.status()).toBe(200);
  }
  await testMedia(page, workout);
  await openAuthenticated(page, `/workouts/${workout.id}`);
  await page.getByRole("button", { name: "여기서 종료" }).click();
  await page.getByRole("button", { name: "종료 확인" }).click();
  await expect.poll(async () => (await read()).status).toBe("interrupted");
  await page.getByRole("button", { name: "이어서 운동하기" }).click();
  await page.getByRole("button", { name: "운동 완료", exact: true }).click();
  await page.getByRole("button", { name: "완료 확인" }).click();
  await expect.poll(async () => (await read()).resultStatus).toBe("completed");
});

test("another device's completion is recovered without overwriting it", async ({
  page,
}) => {
  const { workout, headers, read } = await prepare(page);
  await testMedia(page, workout);
  await openAuthenticated(page, `/workouts/${workout.id}`);
  await page.getByRole("button", { name: "운동 시작", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "운동 완료", exact: true }),
  ).toBeEnabled();
  const completed = await page.request.post(
    `${base}/workouts/${workout.id}/events`,
    {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        type: "complete",
        deviceId: crypto.randomUUID(),
        sequence: 1,
        intervals: [],
        positionSeconds: 0,
      },
    },
  );
  expect(completed.status()).toBe(200);
  await page.getByLabel("운동 영상").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 1;
    v.pause();
  });
  await expect(
    page.getByRole("button", { name: "서버에 저장된 상태로 돌아가기" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "서버에 저장된 상태로 돌아가기" })
    .click();
  await page.getByRole("button", { name: "저장된 상태 불러오기" }).click();
  await expect(
    page.getByText("운동을 완료했어요.", { exact: false }),
  ).toBeVisible();
  expect((await read()).status).toBe("completed");
  await expect(
    page.getByRole("button", { name: "저장 다시 확인하기" }),
  ).toHaveCount(0);
});

test("legacy users are guided to a birth profile, measurement, or unsupported-age notice", async ({
  page,
}) => {
  const registered = await registerTestUser(page, {
    email: `legacy-workout-${crypto.randomUUID()}@example.test`,
    password,
  });
  expect(registered.status()).toBe(201);
  await openAuthenticated(page, "/workouts");
  await expect(page.getByText("아직 운동 이력이 없어요")).toBeVisible();
  await page.getByRole("link", { name: "오늘 운동 받으러 가기" }).click();
  await page.getByRole("button", { name: "오늘 운동 추천받기" }).click();
  await page.getByRole("link", { name: "생년월일 입력하기" }).click();
  await expect(page).toHaveURL(/\/account\/settings$/);
  await page.getByLabel("생년월일 입력", { exact: true }).fill("2000-01-01");
  await saveBirthProfile(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await page.getByRole("button", { name: "오늘 운동 추천받기" }).click();
  await expect(
    page.getByRole("link", { name: "측정 기록 등록하기" }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "내 프로필", exact: true })
    .click();
  await page.getByRole("link", { name: "계정 설정", exact: true }).click();
  await page.getByLabel("생년월일 입력", { exact: true }).fill("1950-01-01");
  await saveBirthProfile(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await page.getByRole("button", { name: "오늘 운동 추천받기" }).click();
  await expect(
    page.getByRole("link", { name: "생년월일 확인하기" }),
  ).toHaveAttribute("href", "/account/settings");
});

test("history retains its first page on failure and retries the same cursor without duplicates", async ({
  page,
}) => {
  const { workout } = await prepare(page);
  let failed = false;
  const cursors: string[] = [];
  // Only pagination metadata and the extra display row are fixtures; the first row is an actual assignment.
  await page.route("**/api/v1/workouts/history?*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const response = await route.fetch();
    const data = await response.json();
    if (!cursor)
      return route.fulfill({
        response,
        json: { ...data, nextCursor: workout.id },
      });
    cursors.push(cursor);
    if (!failed) {
      failed = true;
      return route.fulfill({
        response,
        status: 503,
        json: { message: "history test failure" },
      });
    }
    return route.fulfill({
      response,
      json: {
        items: [
          workout,
          {
            ...workout,
            id: "4129204b-3c7c-4f78-926b-7967b3eb8c18",
            koreanDate: "2026-09-26",
          },
        ],
        nextCursor: null,
      },
    });
  });
  await openAuthenticated(page, "/workouts");
  await expect(page.locator(".workout-list > li")).toHaveCount(1);
  await page.getByRole("button", { name: "이전 운동 더 보기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.locator(".workout-list > li")).toHaveCount(1);
  await page.getByRole("button", { name: "이전 운동 더 보기" }).click();
  await expect(page.locator(".workout-list > li")).toHaveCount(2);
  expect(cursors).toEqual([workout.id, workout.id]);
  await expect(
    page.getByRole("button", { name: "이전 운동 더 보기" }),
  ).toHaveCount(0);
});

// The backend currently assigns one workout/day. This contract fixture validates
// the frontend's multi-assignment navigation; persistence is covered above against PR #9.
test("여러 운동은 각자의 영상과 기록으로 완료하고 목록에서 다음 운동을 시작한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  const mediaUrl = await serveTestMedia(page);
  const rows: Workout[] = [0, 1].map((index) => ({
    ...testWorkout,
    id: `00000000-0000-4000-8000-00000000000${index + 5}`,
    assignedAt: `2026-09-27T00:00:0${index}Z`,
    video: {
      ...testWorkout.video,
      id: `video-${index}`,
      title: index === 0 ? "첫 번째 배정 운동" : "두 번째 배정 운동",
      durationSeconds: 12,
      verifiedDurationSeconds: 12,
      playbackStatus: "verified",
      playbackUrl: mediaUrl,
    },
    progress: { ...testWorkout.progress, durationSeconds: 12 },
  }));
  const events: { id: string; type: PlaybackEvent["type"] }[] = [];
  await page.route("**/api/v1/workouts/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/current")) return route.fulfill({ json: rows[0] });
    if (pathname.endsWith("/history"))
      return route.fulfill({ json: { items: rows, nextCursor: null } });
    const index = rows.findIndex((row) => pathname.includes(`/${row.id}`));
    if (index < 0) return route.fallback();
    if (route.request().method() === "POST") {
      const event = route.request().postDataJSON() as PlaybackEvent;
      events.push({ id: rows[index].id, type: event.type });
      rows[index] = {
        ...rows[index],
        status: event.type === "complete" ? "completed" : "in_progress",
        resultStatus: event.type === "complete" ? "completed" : null,
        completedAt: event.type === "complete" ? "2026-09-27T03:00:00Z" : null,
        revision: rows[index].revision + 1,
        progress: {
          ...rows[index].progress,
          positionSeconds: event.positionSeconds,
        },
      };
    }
    return route.fulfill({ json: rows[index] });
  });
  await page.goto("/workout");
  const list = page.getByRole("list", { name: "오늘 배정된 운동" });
  await expect(list.getByRole("link", { name: "운동 시작하기" })).toHaveCount(
    2,
  );
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    await list
      .getByRole("listitem")
      .filter({ hasText: row.video.title })
      .getByRole("link", { name: "운동 시작하기" })
      .click();
    await expect(page).toHaveURL(`/workouts/${row.id}`);
    await expect(
      page.getByRole("heading", { name: row.video.title }),
    ).toBeVisible();
    const video = page.getByLabel("운동 영상");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    await page.getByRole("button", { name: "운동 시작", exact: true }).click();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(1);
    await page.getByRole("button", { name: "운동 완료", exact: true }).click();
    await page.getByRole("button", { name: "완료 확인" }).click();
    await expect(
      page.getByText("운동을 완료했어요.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("link", { name: "운동 목록으로" }).click();
    await expect(page).toHaveURL("/workout");
    await expect(list.getByText("완료", { exact: true })).toHaveCount(
      index + 1,
    );
    await expect(list.getByRole("link", { name: "운동 시작하기" })).toHaveCount(
      rows.length - index - 1,
    );
  }
  expect(
    events.filter((event) => event.type === "start").map((event) => event.id),
  ).toEqual(rows.map((row) => row.id));
  expect(
    events
      .filter((event) => event.type === "complete")
      .map((event) => event.id),
  ).toEqual(rows.map((row) => row.id));
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByText("완료", { exact: true })).toHaveCount(2);
  await expect(list.getByRole("link")).toHaveCount(0);
});
