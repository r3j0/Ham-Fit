import { test, expect } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";

import { installHomeGroups } from "./home-groups-fixtures";

const mascotName = "나의 대표 캐릭터";

test("메인은 중앙 캐릭터와 운동을 보여 주고 기록은 내 프로필에서 연다", async ({
  page,
}, info) => {
  await installApi(page, testRecord());
  await installHomeGroups(page);
  let polygonRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/measurements/latest-polygon"))
      polygonRequests++;
  });
  await page.goto("/");
  const mascot = page.getByRole("img", { name: mascotName });
  await expect(mascot).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "오늘의 운동" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "내 기존 운동" }),
  ).toBeVisible();
  await expect(page.locator(".latest-fitness")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /측정 기록 보기|상세 리포트 보기/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toHaveCount(0);
  await expect(mascot.locator("svg image")).toHaveAttribute(
    "href",
    "/hamsters/base/basic-cream.webp",
  );
  expect((await page.request.get("/hamsters/base/basic-cream.webp")).ok()).toBe(
    true,
  );
  expect((await page.request.get("/hamsters/base/basic-gray.webp")).ok()).toBe(
    true,
  );
  const group = page.getByRole("region", { name: "내 그룹의 햄스터" });
  const companions = group.getByRole("img");
  await expect(group).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(group).toHaveCSS("border-top-width", "0px");
  await expect(companions).toHaveCount(3);
  for (const character of await companions.all()) {
    await expect(character).toHaveAttribute("data-variant", "cream");
    await expect(character).toHaveAttribute("data-pose", "basic");
    await expect(character).toHaveAttribute("data-wear", "none");
  }
  await expect(
    page.getByRole("heading", { name: "운동 스트릭", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "연속 운동", exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [430, 932],
    [960, 900],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    const bounds = await mascot.boundingBox();
    expect(bounds).not.toBeNull();
    const stage = (await page.locator(".home-mascot-stage").boundingBox())!;
    expect(
      Math.abs(bounds!.x + bounds!.width / 2 - (stage.x + stage.width / 2)),
    ).toBeLessThan(2);
    // The previous main mascot used min(100%, 320px, 40svh), or 360px on desktop.
    const originalWidth =
      width < 960
        ? Math.min(stage.width, 320, height * 0.4)
        : Math.min(stage.width, 360);
    expect(bounds!.width).toBeCloseTo(originalWidth * 0.8, 1);
    const groupBox = (await group.boundingBox())!;
    const todayBox = (await page
      .getByRole("region", { name: "오늘의 운동", exact: true })
      .boundingBox())!;
    const streakBox = (await page
      .getByRole("region", { name: "연속 운동", exact: true })
      .boundingBox())!;
    expect(groupBox.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height);
    expect(groupBox.y - (stage.y + stage.height)).toBeLessThanOrEqual(8);
    expect(streakBox.y).toBeGreaterThanOrEqual(todayBox.y + todayBox.height);
    if (width < 960) {
      expect(todayBox.y).toBeGreaterThanOrEqual(groupBox.y + groupBox.height);
    } else {
      expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(todayBox.x);
      expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(streakBox.x);
      expect(stage.y).toBeCloseTo(todayBox.y, 1);
    }
    const companionBoxes = await Promise.all(
      (await companions.all()).map((item) => item.boundingBox()),
    );
    for (const small of companionBoxes) {
      expect(small!.width).toBeLessThanOrEqual(bounds!.width / 3 + 0.1);
      expect(small!.height).toBeLessThanOrEqual(bounds!.height / 3 + 0.1);
    }
    expect(companionBoxes[0]!.y).toBeCloseTo(companionBoxes[1]!.y, 1);
    expect(companionBoxes[0]!.x + companionBoxes[0]!.width).toBeLessThan(
      companionBoxes[1]!.x,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`home-${width}.png`),
      fullPage: true,
    });
  }
  expect(polygonRequests).toBe(0);
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(page.locator(".latest-fitness")).toBeVisible();
  await page.getByRole("link", { name: "내 측정 기록", exact: true }).click();
  await expect(page.locator(".record-card")).toHaveCount(1);
  await page.locator(".record-card").click();
  await expect(
    page.getByRole("link", { name: "기록 수정", exact: true }),
  ).toBeVisible();
});

test("새 출력기는 동작 줄이기 설정과 화면 이동에도 원본 자세를 유지한다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installApi(page);
  await installHomeGroups(page);
  await page.goto("/");
  const mascot = page.getByRole("img", { name: mascotName, exact: true });
  await expect(mascot).toBeVisible();
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    await expect(mascot.locator("svg")).toHaveAttribute(
      "viewBox",
      "0 0 1000 1000",
    );
    await expect(mascot.locator('image[data-layer="base"]')).toHaveAttribute(
      "href",
      "/hamsters/base/basic-cream.webp",
    );
  }
  await page.getByRole("link", { name: "체력 기록 등록하기" }).click();
  await expect(page).toHaveURL("/onboarding");
  expect(errors).toEqual([]);
});
