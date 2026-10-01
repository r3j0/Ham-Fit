import { test, expect, type Page } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";

import { installHomeGroups } from "./home-groups-fixtures";

async function renderedArt(page: Page) {
  await page
    .locator("[data-pose] svg image")
    .first()
    .waitFor({ state: "attached" });
  await page.locator("[data-pose] svg image").evaluateAll(async (nodes) => {
    for (const node of nodes) {
      const image = new Image();
      image.src = node.getAttribute("href")!;
      await image.decode();
      if (!image.naturalWidth) throw new Error("Missing mascot artwork");
    }
  });
  const ids = await page
    .locator("[data-pose] clipPath")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const width of [320, 390, 1280]) {
  test(`${width}px 로그인 전 첫 화면의 교차 배치와 회원가입의 궁금 캐릭터를 표시한다`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/v1/**", (route) =>
      route.fulfill({ status: 401, json: { message: "Anonymous" } }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
    await page.goto("/login");
    const group = page.getByRole("group", { name: "함께 운동하는 햄스터" });
    const characters = group.getByRole("img");
    await expect(characters).toHaveCount(4);
    const expected = [
      ["cream", "victory", "none"],
      ["gray", "run", "none"],
      ["gray", "drink", "none"],
      ["cream", "situp", "none"],
    ];
    for (const [index, [variant, pose, wear]] of expected.entries()) {
      await expect(characters.nth(index)).toHaveAttribute(
        "data-variant",
        variant,
      );
      await expect(characters.nth(index)).toHaveAttribute("data-pose", pose);
      await expect(characters.nth(index)).toHaveAttribute("data-wear", wear);
      await expect(characters.nth(index)).toHaveCSS(
        "z-index",
        index % 2 ? "2" : "1",
      );
    }
    await renderedArt(page);
    const boxes = await Promise.all(
      (await characters.all()).map((character) => character.boundingBox()),
    );
    const frame = (await group.boundingBox())!;
    for (const [i, box] of boxes.entries()) {
      expect(box!.x).toBeGreaterThanOrEqual(frame.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        frame.x + frame.width + 1,
      );
      if (i > 0) expect(box!.x).toBeGreaterThan(boxes[i - 1]!.x);
      if (i % 2) expect(box!.y).toBeGreaterThan(boxes[i - 1]!.y);
    }
    await page
      .getByLabel("이메일", { exact: true })
      .fill("mascot@example.test");
    await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(
      "mascot@example.test",
    );
    await page.screenshot({
      path: info.outputPath(`welcome-${width}.png`),
      fullPage: true,
      style: "nextjs-portal { display:none }",
    });
    await page.goto("/register");
    const pair = page.getByRole("group", { name: "가입을 기다리는 햄스터" });
    await expect(pair.getByRole("img")).toHaveCount(2);
    await expect(
      pair.locator(
        '[data-variant="cream"][data-pose="curious"][data-wear="none"]',
      ),
    ).toBeVisible();
    await expect(
      pair.locator(
        '[data-variant="gray"][data-pose="curious"][data-wear="none"]',
      ),
    ).toBeVisible();
    await renderedArt(page);
    await page
      .getByRole("button", { name: "가입하고 시작하기", exact: true })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "가입하고 시작하기", exact: true })
      .click({ trial: true });
    await page.getByLabel("생년월일", { exact: true }).focus();
    await page.screenshot({
      path: info.outputPath(`signup-${width}.png`),
      fullPage: true,
      style: "nextjs-portal { display:none }",
    });
    expect(errors).toEqual([]);
  });
}

test("그룹·체력 기록·간이측정·탈퇴 확인의 캐릭터를 읽기 전용으로 표시한다", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const api = await installApi(page, testRecord());
  await installHomeGroups(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "내 그룹의 햄스터" }).getByRole("img"),
  ).toHaveCount(3);
  await renderedArt(page);
  await page.screenshot({
    path: info.outputPath("home.png"),
    fullPage: true,
    style: "nextjs-portal { display:none }",
  });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, variant, pose] of [
      ["/onboarding", "cream", "curious"],
      ["/workout?mode=assessment", "gray", "situp"],
    ]) {
      await page.goto(path);
      await expect(
        page.locator(
          `[data-variant="${variant}"][data-pose="${pose}"][data-wear="none"]`,
        ),
      ).toBeVisible();
      await renderedArt(page);
      await page.screenshot({
        path: info.outputPath(`${pose}-${width}.png`),
        fullPage: true,
        style: "nextjs-portal { display:none }",
      });
    }
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/account/settings?tab=delete");
  await page
    .getByLabel("현재 비밀번호", { exact: true })
    .fill("not-submitted-password");
  await page
    .getByRole("form", { name: "회원 탈퇴", exact: true })
    .getByRole("button", { name: "회원 탈퇴", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "정말 탈퇴할까요?" });
  await expect(
    dialog.locator(
      '[data-variant="cream"][data-pose="cant-hear"][data-wear="none"]',
    ),
  ).toBeVisible();
  await renderedArt(page);
  await dialog
    .getByRole("button", { name: "취소", exact: true })
    .click({ trial: true });
  await page.screenshot({
    path: info.outputPath("delete-dialog.png"),
    style: "nextjs-portal { display:none }",
  });
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(api.mutations).toEqual([]);
  expect(errors).toEqual([]);
});
