import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { Workout } from "../../lib/workout-types";
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
// All persistence is the actual PR #9 API. Only media delivery is replaced with a tiny generated MP4.
async function testMedia(page: Page, workout: Workout) {
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
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await expect(
    page.getByText("오늘의 운동을 완료했어요.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "오늘 운동 추천받기" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "내 운동 이력", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "완료 기록 보기" }),
  ).toHaveAttribute("href", `/workouts/${workout.id}`);
  await expect(page.getByText("최근 수행일", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "완료 기록 보기" }).click();
  await expect(
    page.getByText("운동을 완료했어요.", { exact: false }),
  ).toBeVisible();
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
  await page.getByLabel("생년월일 입력", { exact: true }).fill("1950-01-01");
  await saveBirthProfile(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await page.getByRole("button", { name: "오늘 운동 추천받기" }).click();
  await expect(
    page.getByRole("link", { name: "생년월일 확인하기" }),
  ).toBeVisible();
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
