import { expect, test, type Page } from "@playwright/test";
import type { Workout } from "../../lib/workout-types";
import { installApi, testRecord, testWorkout } from "./integration-fixtures";

const completed: Workout = {
  ...testWorkout,
  video: {
    ...testWorkout.video,
    title: "고정한 상태에서 덤벨 들고 팔꿈치 굽히기",
  },
  status: "completed",
  completedAt: "2026-09-27T09:00:00Z",
  progress: {
    ...testWorkout.progress,
    watchedSeconds: 15,
    positionSeconds: 15,
    intervals: [{ start: 0, end: 15 }],
    ratio: 0.25,
  },
};
async function setup(page: Page, rows = [completed]) {
  const api = await installApi(page, testRecord());
  await page.route("**/api/v1/workouts/history?*", (route) =>
    route.fulfill({ json: { items: rows, nextCursor: null } }),
  );
  await page.route("**/api/v1/workouts/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    const row = path.endsWith("/current")
      ? rows[0]
      : rows.find((item) => path.endsWith(`/${item.id}`));
    return row ? route.fulfill({ json: row }) : route.fallback();
  });
  return api;
}

test("다시보기는 날짜와 완료 아이콘, 실제 시청률만 표시하고 좁은 화면에서도 읽을 수 있다", async ({
  page,
}, info) => {
  const api = await setup(page);
  await page.goto(`/workouts/${completed.id}/replay`);
  const heading = page.getByRole("heading", {
    name: completed.video.title,
    exact: true,
  });
  const status = page.getByRole("img", { name: "운동 완료", exact: true });
  await expect(heading).toBeVisible();
  await expect(status).toHaveCSS("color", "rgb(22, 134, 75)");
  await expect(page.locator("main time")).toHaveText("2026년 9월 27일");
  await expect(page.getByText(/배정 ·|운동을 완료했어요/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "저장된 운동 상태 확인" }),
  ).toHaveCount(0);
  const progress = page.getByRole("progressbar", {
    name: "저장된 시청 진행률",
  });
  // Completion must not inflate the stored watched ratio to 100%.
  await expect(progress).toHaveAttribute("value", "0.25");
  await expect(progress).toHaveAttribute("aria-valuetext", "25%, 15초 / 60초");
  await expect(page.getByText("0:15 / 1:00", { exact: true })).toBeVisible();
  await expect(progress).toHaveCSS("accent-color", "rgb(27, 153, 196)");
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(status).toBeVisible();
    const iconBox = (await status.boundingBox())!;
    const titleBox = (await heading.boundingBox())!;
    expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(titleBox.x);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(progress).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`replay-${width}.png`),
      fullPage: true,
    });
  }
  expect(api.mutations).toEqual([]);
});

test("운동 상태는 완료 초록, 진행 중 회색, 나머지 미완료 노랑 아이콘으로 구별한다", async ({
  page,
}) => {
  const statuses = [
    "completed",
    "in_progress",
    "assigned",
    "interrupted",
    "not_performed",
  ] as const;
  await setup(
    page,
    statuses.map((status, index) => ({
      ...completed,
      id: `status-${index}`,
      status,
      completedAt: status === "completed" ? completed.completedAt : null,
    })),
  );
  await page.goto("/workouts");
  const cards = page.locator(".workout-card");
  await expect(cards).toHaveCount(5);
  const labels = [
    "운동 완료",
    "운동 진행 중",
    "운동 미완료 (시작 전)",
    "운동 미완료 (중단)",
    "운동 미완료 (미진행)",
  ];
  const colors = [
    "rgb(22, 134, 75)",
    "rgb(100, 116, 139)",
    ...Array(3).fill("rgb(155, 113, 0)"),
  ];
  for (let index = 0; index < statuses.length; index++) {
    await expect(
      cards.nth(index).getByRole("img", { name: labels[index], exact: true }),
    ).toHaveCSS("color", colors[index]);
    await expect(cards.nth(index).locator("time")).toHaveText(
      "2026년 9월 27일",
    );
  }
});

test("운동 하위 경로와 메뉴에 Skyblue를 적용하고 메인과 프로필 테마는 보존한다", async ({
  page,
}) => {
  await setup(page);
  for (const [path, title] of [
    ["/workout?mode=assessment", "간이측정"],
    ["/workout", "운동"],
    ["/workouts", "운동 이력"],
    ["/workouts/history/2026-09-27", "운동 기록 상세"],
    [`/workouts/${completed.id}`, "운동 중"],
    [`/workouts/${completed.id}/replay`, "운동 다시보기"],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: title, exact: true, level: 1 }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("main")
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--accent").trim(),
          ),
      )
      .toBe("#1b99c4");
    const nav = page.getByRole("navigation", { name: "하단 메뉴" });
    if (path.includes("mode=assessment")) {
      await expect(nav).toBeHidden();
    } else {
      await expect(nav.locator("a[aria-current] svg")).toHaveCSS(
        "color",
        "rgb(6, 43, 58)",
      );
    }
    if (path === "/workout" || path.includes("/history/")) {
      await expect(
        page.getByText(/운동 완료를 확인한 날짜|한국 시간 기준|밑줄은 오늘/),
      ).toHaveCount(0);
    }
  }
  // Client-side navigation must not retain the workout route's theme.
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "내 프로필" })
    .click();
  await expect(page.locator("main")).toHaveCSS("color", "rgb(51, 37, 28)");
  await expect(
    page.getByRole("navigation").locator("a[aria-current] svg"),
  ).toHaveCSS("color", "rgb(255, 127, 0)");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await expect(page.locator("main")).toHaveCSS("color", "rgb(15, 23, 42)");
});
