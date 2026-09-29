import { test, expect, type Page } from "@playwright/test";
import {
  installApi,
  testRecord,
  testWorkout,
  testUser,
} from "./integration-fixtures";
import type { Workout } from "../../lib/workout-types";

// The calendar must remain Korean even when the viewer's local date is the previous day.
test.use({ timezoneId: "America/Los_Angeles" });
const fixedDate = new Date("2026-09-27T12:00:00+09:00");
function completed(id: string, day: string): Workout {
  return {
    ...testWorkout,
    id,
    status: "completed",
    completedAt: `${day}T16:00:00+09:00`,
    koreanDate: "2026-08-01",
  };
}
async function setup(page: Page) {
  const api = await installApi(page, testRecord());
  await page.clock.setFixedTime(fixedDate);
  await page.route("**/api/v1/users/me/profile/activity", (route) =>
    route.fulfill({
      json: {
        userId: testUser.id,
        nickname: null,
        profileCharacter: null,
        streak: 3,
      },
    }),
  );
  const rows = [
    completed("today", "2026-09-27"),
    completed("today-again", "2026-09-27"),
    completed("yesterday", "2026-09-26"),
    completed("older", "2026-09-25"),
    testWorkout,
  ];
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: rows, nextCursor: null } }),
  );
  await page.route("**/api/v1/workouts/*", (route) => {
    const row = rows.find((workout) =>
      route.request().url().endsWith(`/${workout.id}`),
    );
    return row ? route.fulfill({ json: row }) : route.fallback();
  });
  return { ...api, rows };
}

test("서버 완료일만 달력과 스트릭에 표시하고 같은 날 중복 완료는 하루로 집계한다", async ({
  page,
}) => {
  const api = await setup(page);
  await page.goto("/");
  const streak = page.getByRole("region", { name: "연속 운동" });
  await expect(streak).toContainText("3일 연속 운동 중");
  await expect(streak).toContainText("오늘의 운동을 완료했어요!");
  await expect(streak.getByRole("listitem")).toHaveCount(7);
  await streak.getByRole("link", { name: "운동 기록 보기" }).click();
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await expect(calendar.getByText("3일 운동했어요")).toBeVisible();
  await expect(
    calendar.getByRole("link", {
      name: "9월 27일 오늘, 운동함",
      exact: true,
    }),
  ).toHaveAttribute("data-completed", "true");
  await expect(
    calendar.getByRole("link", { name: /완료 기록 보기/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "선택한 날짜의 운동 기록" }),
  ).toHaveCount(0);
  await calendar
    .getByRole("link", { name: "9월 27일 오늘, 운동함", exact: true })
    .click();
  await expect(page).toHaveURL("/workouts/history/2026-09-27");
  await expect(
    page.getByRole("heading", { name: "운동 기록 상세", exact: true }),
  ).toBeVisible();
  const records = page.getByRole("list", { name: "선택한 날짜의 운동 기록" });
  await expect(records.getByRole("listitem")).toHaveCount(2);
  await expect(records.getByRole("link").first()).toHaveAttribute(
    "href",
    "/workouts/today/replay",
  );
  const calendarBox = (await calendar.boundingBox())!;
  expect((await records.boundingBox())!.y).toBeGreaterThanOrEqual(
    calendarBox.y + calendarBox.height,
  );
  await expect(
    calendar.getByRole("link", {
      name: "9월 27일 오늘, 운동함, 총 2분 0초 운동",
      exact: true,
    }),
  ).toHaveAttribute("data-selected", "true");
  await expect(calendar.getByText("3일 운동했어요")).toHaveCount(0);
  await expect(calendar.locator("tbody tr")).toHaveCount(1);
  await expect(
    calendar.getByRole("button", { name: "주", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await calendar.getByRole("button", { name: "월", exact: true }).click();
  await expect(calendar.locator("tbody tr")).toHaveCount(5);
  await expect(
    calendar.getByRole("button", { name: "월", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await calendar.getByRole("button", { name: "주", exact: true }).click();
  await expect(calendar.locator("tbody tr")).toHaveCount(1);
  await calendar.getByRole("button", { name: "이전 주" }).click();
  await calendar
    .getByRole("link", {
      name: "9월 26일, 운동함, 총 1분 0초 운동",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/workouts/history/2026-09-26");
  await expect(records.getByRole("listitem")).toHaveCount(1);
  await expect(records.getByRole("link")).toHaveAttribute(
    "href",
    "/workouts/yesterday/replay",
  );
  await page.reload();
  await expect(records.getByRole("listitem")).toHaveCount(1);
  await records.getByRole("link").click();
  await expect(page).toHaveURL("/workouts/yesterday/replay");
  await expect(
    page.getByRole("heading", { name: "운동 다시보기", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "운동 중", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("현재 이 영상을 재생할 수 없어요.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "운동 기록으로", exact: true }).click();
  await expect(page).toHaveURL("/workouts/history/2026-09-26");
  await expect(records.getByRole("listitem")).toHaveCount(1);
  expect(api.mutations).toEqual([]);
});

test("달력은 이전 달과 빈 달을 키보드로 탐색하며 배정일을 완료일로 표시하지 않는다", async ({
  page,
}) => {
  const api = await setup(page);
  await page.goto("/workout");
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  await expect(
    calendar.getByRole("button", { name: "다음 달" }),
  ).toBeDisabled();
  await expect(
    calendar.getByRole("button", { name: "9월 28일, 아직 오지 않은 날" }),
  ).toBeDisabled();
  await calendar.getByRole("button", { name: "이전 달" }).click();
  await expect(
    calendar.getByRole("heading", { name: "2026년 8월" }),
  ).toBeVisible();
  await expect(calendar.locator("tbody tr")).toHaveCount(6);
  await expect(calendar.getByText("0일 운동했어요")).toBeVisible();
  const date = calendar.getByRole("button", {
    name: "8월 1일, 완료 기록 없음",
    exact: true,
  });
  await expect(date).toBeDisabled();
  await expect(calendar.getByText("완료한 운동 기록이 없어요")).toHaveCount(0);
  await expect(calendar.locator("tbody a")).toHaveCount(0);
  await calendar.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(
    calendar.getByRole("link", {
      name: "9월 27일 오늘, 운동함",
      exact: true,
    }),
  ).toHaveAttribute("href", "/workouts/history/2026-09-27");
  expect(api.mutations).toEqual([]);
});

test("이력의 모든 페이지를 읽고 실패 시 0일로 오인시키지 않으며 재시도로 복구한다", async ({
  page,
}) => {
  await setup(page);
  let fail = true;
  const cursors: (string | null)[] = [];
  await page.route("**/api/v1/workouts/history?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if (cursor && fail)
      return route.fulfill({ status: 503, json: { message: "Unavailable" } });
    return route.fulfill({
      json: cursor
        ? { items: [completed("yesterday", "2026-09-26")], nextCursor: null }
        : { items: [completed("today", "2026-09-27")], nextCursor: "next" },
    });
  });
  await page.goto("/");
  const streak = page.getByRole("region", { name: "연속 운동" });
  await expect(streak.getByRole("alert")).toBeVisible();
  await expect(streak).toContainText("3일 연속 운동 중");
  expect(cursors).toContain("next");
  fail = false;
  await streak.getByRole("button", { name: "운동 기록 다시 불러오기" }).click();
  await expect(streak).toContainText("3일 연속 운동 중");
  await streak.getByRole("link", { name: "운동 기록 보기" }).click();
  await expect(
    page.getByRole("region", { name: "운동 기록", exact: true }),
  ).toContainText("2일 운동했어요");
});

for (const width of [320, 390, 430, 1280]) {
  test(`${width}px 스트릭과 달력은 화면을 넘치지 않고 모든 날짜를 표시한다`, async ({
    page,
  }, info) => {
    await setup(page);
    await page.clock.setFixedTime(fixedDate);
    await page.route("**/api/v1/users/me/profile/activity", (route) =>
      route.fulfill({
        json: {
          userId: testUser.id,
          nickname: null,
          profileCharacter: null,
          streak: 3,
        },
      }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    await page.goto("/");
    const streak = page.getByRole("region", { name: "연속 운동" });
    await expect(streak).toBeVisible();
    const heading = streak.getByRole("heading", {
      name: "연속 운동",
      exact: true,
    });
    const card = streak.locator(":scope > div").last();
    await expect(card.getByRole("heading")).toHaveCount(0);
    const headingBox = (await heading.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(headingBox.y + headingBox.height).toBeLessThan(cardBox.y);
    const todayHeading = page.getByRole("heading", {
      name: "오늘의 운동",
      exact: true,
    });
    for (const property of ["font-size", "font-weight", "color"]) {
      const expected = await todayHeading.evaluate(
        (el, prop) => getComputedStyle(el).getPropertyValue(prop),
        property,
      );
      await expect(heading).toHaveCSS(property, expected);
    }
    const summary = streak
      .getByText("3일 연속 운동 중", { exact: true })
      .locator("..");
    const week = streak.getByRole("list", { name: "최근 7일 운동 기록" });
    const summaryBox = (await summary.boundingBox())!;
    const weekBox = (await week.boundingBox())!;
    expect(summaryBox.x + summaryBox.width).toBeLessThanOrEqual(weekBox.x);
    expect(
      Math.abs(
        summaryBox.y + summaryBox.height / 2 - weekBox.y - weekBox.height / 2,
      ),
    ).toBeLessThan(1);
    await expect(week.getByRole("listitem")).toHaveCount(7);
    for (const day of await week.getByRole("listitem").all()) {
      const box = (await day.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(weekBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(
        weekBox.x + weekBox.width + 1,
      );
    }
    const link = streak.getByRole("link", { name: "운동 기록 보기" });
    const linkBox = (await link.boundingBox())!;
    const padding = await card.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingRight),
    );
    expect(linkBox.x + linkBox.width).toBeCloseTo(
      cardBox.x + cardBox.width - padding,
      1,
    );
    expect(linkBox.y).toBeGreaterThanOrEqual(
      Math.max(summaryBox.y + summaryBox.height, weekBox.y + weekBox.height),
    );
    await page.screenshot({
      path: info.outputPath(`streak-${width}.png`),
      fullPage: true,
    });
    await streak.getByRole("link", { name: "운동 기록 보기" }).click();
    const calendar = page.getByRole("region", {
      name: "운동 기록",
      exact: true,
    });
    await expect(calendar.getByRole("table")).toBeVisible();
    await expect(calendar.locator("tbody button, tbody a")).toHaveCount(30);
    for (const button of await calendar.locator("button, a").all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`calendar-${width}.png`),
      fullPage: true,
    });
    await calendar
      .getByRole("link", { name: "9월 27일 오늘, 운동함", exact: true })
      .click();
    const records = page.getByRole("list", { name: "선택한 날짜의 운동 기록" });
    await expect(records.getByRole("listitem")).toHaveCount(2);
    const calendarBox = (await calendar.boundingBox())!;
    expect((await records.boundingBox())!.y).toBeGreaterThanOrEqual(
      calendarBox.y + calendarBox.height,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`history-detail-${width}.png`),
      fullPage: true,
    });
  });
}

test("날짜 상세의 빈 날짜·잘못된 날짜와 이력 조회 실패를 구분한다", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/workouts/history/2026-08-01");
  await expect(
    page.getByRole("heading", {
      name: "2026년 7월 26일 – 8월 1일",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("이 날짜에 완료한 운동 기록이 없어요."),
  ).toBeVisible();
  await page.goto("/workouts/history/2026-02-30");
  await expect(
    page.getByRole("heading", { name: "찾으시는 화면이 없어요" }),
  ).toBeVisible();
  let fail = true;
  await page.route("**/api/v1/workouts/history?*", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { message: "Unavailable" } })
      : route.fulfill({
          json: { items: [completed("today", "2026-09-27")], nextCursor: null },
        }),
  );
  await page.goto("/workouts/history/2026-09-27");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByText("이 날짜에 완료한 운동 기록이 없어요."),
  ).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "운동 기록 다시 불러오기" }).click();
  await expect(
    page
      .getByRole("list", { name: "선택한 날짜의 운동 기록" })
      .getByRole("listitem"),
  ).toHaveCount(1);
});

test("미완료 운동의 다시보기 주소에서는 재생·완료 이벤트를 보내지 않는다", async ({
  page,
}) => {
  const api = await setup(page);
  await page.goto(`/workouts/${testWorkout.id}/replay`);
  await expect(
    page.getByText("완료한 운동만 다시 볼 수 있어요."),
  ).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "운동 완료", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "운동 이어하기", exact: true }).click();
  await expect(page).toHaveURL(`/workouts/${testWorkout.id}`);
  await expect(
    page.getByRole("heading", { name: "운동 중", exact: true }),
  ).toBeVisible();
  expect(api.mutations).toEqual([]);
});
