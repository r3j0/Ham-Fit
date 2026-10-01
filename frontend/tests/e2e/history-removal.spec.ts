import { expect, test } from "@playwright/test";
import { installApi, testRecord, testWorkout } from "./integration-fixtures";

test("프로필 이력 진입점과 목록 주소를 제거하고 운동 달력·상세·다시보기는 보존한다", async ({
  page,
}) => {
  const api = await installApi(page, testRecord());
  const completed = {
    ...testWorkout,
    status: "completed",
    completedAt: "2026-09-27T03:00:00.000Z",
  };
  await page.route("**/workouts/history?*", (route) =>
    route.fulfill({ json: { items: [completed], nextCursor: null } }),
  );
  await page.route(`**/api/v1/workouts/${completed.id}`, (route) =>
    route.fulfill({ json: completed }),
  );
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "내 프로필", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "내 운동 이력", exact: true }),
  ).toHaveCount(0);
  for (const path of ["/workouts", "/account/workouts"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "운동 이력", exact: true }),
    ).toHaveCount(0);
  }
  await page.goto("/workout");
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await calendar
    .getByRole("link", { name: "9월 27일 오늘, 운동함", exact: true })
    .click();
  await expect(page).toHaveURL("/workouts/history/2026-09-27");
  const records = page.getByRole("list", { name: "선택한 날짜의 운동 기록" });
  await records.getByRole("link").click();
  await expect(page).toHaveURL(`/workouts/${completed.id}/replay`);
  await expect(
    page.getByRole("heading", { name: "운동 다시보기", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "운동 기록으로", exact: true }).click();
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL("/workout");
  expect(api.mutations).toEqual([]);
});

test("운동 달력의 단일 운동 이력은 다음 페이지 실패를 복구하고 중복 없이 표시한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  const workout = {
    ...testWorkout,
    status: "completed",
    completedAt: "2026-09-27T03:00:00.000Z",
  };
  let fail = true;
  const cursors: string[] = [];
  await page.route("**/api/v1/workouts/history?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor)
      return route.fulfill({
        json: { items: [workout], nextCursor: workout.id },
      });
    cursors.push(cursor);
    if (fail) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: {
        items: [
          workout,
          {
            ...workout,
            id: "4129204b-3c7c-4f78-926b-7967b3eb8c18",
            completedAt: "2026-09-26T03:00:00.000Z",
          },
        ],
        nextCursor: null,
      },
    });
  });
  await page.goto("/workout");
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await expect(calendar.getByRole("alert")).toBeVisible();
  fail = false;
  await calendar
    .getByRole("button", { name: "운동 기록 다시 불러오기" })
    .click();
  await expect(calendar.getByText("2일 운동했어요")).toBeVisible();
  expect(cursors.length).toBeGreaterThanOrEqual(2);
  expect(cursors.every((cursor) => cursor === workout.id)).toBe(true);
  await calendar
    .getByRole("link", { name: "9월 27일 오늘, 운동함", exact: true })
    .click();
  await expect(
    page
      .getByRole("list", { name: "선택한 날짜의 운동 기록" })
      .getByRole("listitem"),
  ).toHaveCount(1);
});
