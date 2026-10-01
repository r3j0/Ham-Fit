import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { routineFixture } from "../fixtures/routine";
import { installRoutine } from "./workout-routine-fixtures";
import { testOutfit } from "./integration-fixtures";

for (const width of [320, 600, 1218]) {
  test(`${width}px 운동 방법은 영상 오른쪽 또는 아래에 있고 횟수·유지·시간을 보존한다`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const row = routineFixture();
    const item = row.routine[0];
    item.playbackUrl =
      "https://openapi.kspo.or.kr/web/video/presentation-test.mp4";
    item.playbackStatus = "verified";
    item.verifiedDurationSeconds = item.progress.durationSeconds = 12;
    await installRoutine(page, row);
    let variant = "gray";
    await page.route("**/api/v1/users/me/avatar/outfit", (route) =>
      route.fulfill({
        json: {
          ...testOutfit,
          characterId: `character.${variant}`,
          rendering: { ...testOutfit.rendering, variant },
        },
      }),
    );
    await page.route(item.playbackUrl, async (route) =>
      route.fulfill({
        contentType: "video/mp4",
        body: await readFile("tests/fixtures/workout.mp4"),
      }),
    );
    for (const [doseType, value, unit] of [
      ["reps", "10~15", "회"],
      ["hold", "20", "초 유지"],
      ["timed", "30", "초"],
    ] as const) {
      variant = doseType === "hold" ? "cream" : "gray";
      item.prescription = {
        doseType,
        value,
        unit,
        sets: 3,
        restSec: 20,
        text: `${value}${unit} × 3세트`,
      };
      await page.goto(`/workout-routines/${row.id}/items/${item.id}`);
      const guide = page.getByRole("region", { name: "운동 방법" });
      const mascot = guide.getByRole("img", { name: "푸시업하는 내 햄스터" });
      await expect(mascot).toHaveAttribute("data-pose", "pushup");
      await expect(mascot).toHaveAttribute("data-variant", variant);
      const headingBox = (await guide.getByRole("heading").boundingBox())!,
        mascotBox = (await mascot.boundingBox())!,
        instructionBox = (await guide
          .getByText("아래와 같은 방식으로 운동하세요!")
          .boundingBox())!;
      expect(mascotBox.y).toBeGreaterThanOrEqual(
        headingBox.y + headingBox.height,
      );
      expect(instructionBox.y).toBeGreaterThanOrEqual(
        mascotBox.y + mascotBox.height,
      );
      await expect(guide).toContainText("아래와 같은 방식으로 운동하세요!");
      await expect(
        guide.getByText("아래와 같은 방식으로 운동하세요!"),
      ).toHaveCSS("font-weight", "700");
      await expect(guide).toContainText(`${value}${unit}`);
      await expect(guide).toContainText("20초");
      await expect(guide).toContainText("3세트");
      await expect(guide.getByRole("listitem")).toHaveCount(3);
      await expect(page.getByText(/번째 운동|장비 정보 없음/)).toHaveCount(0);
      await expect(
        page.getByText(item.prescription.text, { exact: true }),
      ).toHaveCount(0);
      const video = page.getByLabel("운동 영상");
      const mediaBox = (await video.boundingBox())!,
        box = (await guide.boundingBox())!;
      if (width >= 960) {
        expect(box.x).toBeGreaterThan(mediaBox.x + mediaBox.width);
        expect(box.y).toBeCloseTo(mediaBox.y, 0);
      } else expect(box.y).toBeGreaterThan(mediaBox.y + mediaBox.height);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`exercise-guide-${width}-${doseType}.png`),
        fullPage: true,
      });
    }
  });

  test(`${width}px 마무리 유산소는 운동 카드와 같은 열·높이·간격을 사용한다`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const row = routineFixture();
    row.cardioRecommendation = { activity: "걷기", minutes: 30 };
    await installRoutine(page, row);
    await page.goto("/workout");
    const list = page.getByRole("list", { name: "오늘 배정된 운동" });
    const first = list.getByRole("listitem").first(),
      last = list.getByRole("listitem").last();
    const cardio = page.getByRole("region", { name: "유산소 운동 안내" });
    await expect(cardio).toContainText("걷기 30분");
    const cardBox = (await first.boundingBox())!,
      lastBox = (await last.boundingBox())!,
      cardioBox = (await cardio.boundingBox())!;
    expect(cardioBox.x).toBeCloseTo(cardBox.x, 1);
    expect(cardioBox.width).toBeCloseTo(cardBox.width, 1);
    expect(cardioBox.height).toBeCloseTo(cardBox.height, 1);
    expect(cardioBox.y - lastBox.y - lastBox.height).toBeCloseTo(12, 1);
    const doseBox = (await first
        .getByRole("group", { name: "저장된 운동 처방" })
        .boundingBox())!,
      cardioDose = (await cardio.getByText("걷기 30분").boundingBox())!;
    expect(cardioDose.x).toBeCloseTo(doseBox.x, 1);
    await expect(cardio.getByRole("button")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`workout-cardio-${width}.png`),
      fullPage: true,
    });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "유산소 운동 안내" }),
    ).toHaveCount(0);
  });
}

test("운동 기록 위 내 햄스터는 추천 전·배정·진행·미완료·전체 완료 상태와 회원 색상을 반영한다", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1218, height: 900 });
  const row = routineFixture();
  const state = await installRoutine(page, null, row);
  await page.route("**/api/v1/users/me/avatar/outfit", (route) =>
    route.fulfill({
      json: {
        ...testOutfit,
        characterId: "character.gray",
        rendering: { ...testOutfit.rendering, variant: "gray" },
      },
    }),
  );
  await page.goto("/workout");
  const mascot = page.getByRole("img", {
    name: "오늘의 운동 상태를 보여주는 내 햄스터",
  });
  await expect(mascot).toHaveAttribute("data-pose", "lying");
  await expect(mascot).toHaveAttribute("data-variant", "gray");
  await page
    .getByRole("button", { name: "오늘 운동 준비하기", exact: true })
    .click();
  await expect(mascot).toHaveAttribute("data-pose", "run");
  for (const [status, pose] of [
    ["in_progress", "run"],
    ["interrupted", "droopy"],
    ["not_performed", "droopy"],
  ] as const) {
    row.routine[0].status = status;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(mascot).toHaveAttribute("data-pose", pose);
  }
  for (const item of row.routine) {
    item.status = "completed";
    item.resultStatus = "completed";
    item.completedAt = item.performedAt = row.serverTime;
  }
  row.status = "completed";
  row.progress.completedItems = row.routine.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(mascot).toHaveAttribute("data-pose", "drink");
  const calendar = page.getByRole("region", { name: "운동 기록", exact: true });
  const mascotBox = (await mascot.boundingBox())!,
    calendarBox = (await calendar.boundingBox())!;
  expect(mascotBox.y + mascotBox.height).toBeLessThan(calendarBox.y);
  expect(mascotBox.x + mascotBox.width / 2).toBeCloseTo(
    calendarBox.x + calendarBox.width / 2,
    0,
  );
  await page.screenshot({
    path: info.outputPath("workout-mascot-completed.png"),
    fullPage: true,
  });
  expect(state.row?.status).toBe("completed");
});

test("홈은 빈 그룹 영역을 숨기고 두 제목은 KSPO Blue이며 완료일에는 해바라기씨를 표시한다", async ({
  page,
}, info) => {
  const row = routineFixture();
  for (const item of row.routine) {
    item.status = "completed";
    item.resultStatus = "completed";
    item.completedAt = item.performedAt = row.serverTime;
  }
  row.status = "completed";
  row.progress.completedItems = row.routine.length;
  await installRoutine(page, row);
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "내 그룹의 햄스터" }),
  ).toHaveCount(0);
  await expect(page.getByText("아직 가입한 그룹이 없어요.")).toHaveCount(0);
  for (const name of ["오늘의 운동", "연속 운동"])
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCSS(
      "color",
      "rgb(10, 42, 112)",
    );
  const week = page.getByRole("list", { name: "최근 7일 운동 기록" });
  const seed = week.locator('img[src="/icons/sunflower-seed.svg"]');
  await expect(seed).toHaveCount(1);
  await expect
    .poll(() => seed.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(week.locator('li[aria-label$="운동함"]')).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("home-seed-completed.png"),
    fullPage: true,
  });
});

for (const width of [320, 600, 1218]) {
  test(`${width}px 상태 햄스터는 모바일 목록 위·데스크톱 기록 위에 있다`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await installRoutine(page, routineFixture());
    await page.goto("/workout");
    const mascot = page.getByRole("img", {
      name: "오늘의 운동 상태를 보여주는 내 햄스터",
    });
    await expect(mascot).toBeVisible();
    const box = (await mascot.boundingBox())!;
    const list = (await page
      .getByRole("list", { name: "오늘 배정된 운동" })
      .boundingBox())!;
    const calendar = (await page
      .getByRole("region", { name: "운동 기록", exact: true })
      .boundingBox())!;
    if (width < 960) expect(box.y + box.height).toBeLessThan(list.y);
    else {
      expect(box.x).toBeGreaterThan(list.x + list.width);
      expect(box.y + box.height).toBeLessThan(calendar.y);
    }
    await page.screenshot({
      path: info.outputPath(`mascot-position-${width}.png`),
      fullPage: true,
    });
  });
}
