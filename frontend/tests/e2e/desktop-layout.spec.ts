import { test, expect, type Page } from "@playwright/test";
import {
  installApi,
  catalog as assessmentCatalog,
} from "./integration-fixtures";
import {
  storedRecordFixture,
  storedCatalogFixture,
} from "../fixtures/measurement-evaluation";

test.use({
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
  viewport: { width: 1280, height: 900 },
});

async function installDesktopApi(page: Page) {
  const record = storedRecordFixture();
  const catalog = {
    ...storedCatalogFixture,
    definitions: [
      ...storedCatalogFixture.definitions,
      ...assessmentCatalog.definitions.filter(
        (definition) =>
          !storedCatalogFixture.definitions.some(
            (stored) => stored.code === definition.code,
          ),
      ),
    ],
  };
  const api = await installApi(page, record, catalog);
  await page.route("**/measurements/latest-polygon", (route) =>
    route.fulfill({
      json: {
        measurementId: record.id,
        revision: record.revision,
        measuredOn: record.measuredOn,
        axes: record.axes,
      },
    }),
  );
  await page.route("**/users/me/preferences", (route) =>
    route.fulfill({
      json: {
        exerciseVolume: "standard",
        exerciseGoal: null,
        updatedAt: "2026-09-26T00:00:00.000Z",
      },
    }),
  );
  return { api, record };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  const main = (await page.getByRole("main").boundingBox())!;
  expect(main.x).toBeGreaterThanOrEqual(0);
  expect(main.x + main.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const nav = page.getByRole("navigation", { name: "하단 메뉴" });
  if (await nav.isVisible()) {
    const box = (await nav.boundingBox())!;
    expect(box.y).toBe(0);
    expect(main.y).toBeGreaterThanOrEqual(box.y + box.height);
  }
}

for (const width of [960, 1280, 1440]) {
  test(`${width}px 모든 기존 페이지는 넓은 레이아웃에서 메뉴와 겹치거나 가로로 넘치지 않는다`, async ({
    page,
  }, info) => {
    const { api, record } = await installDesktopApi(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    const pages = [
      ["home", "/", page.getByRole("heading", { name: "운동 스트릭" })],
      [
        "workout",
        "/workout",
        page.getByRole("region", { name: "운동 기록", exact: true }),
      ],
      ["account", "/account", page.locator(".fitness-radar")],
      [
        "preferences",
        "/account/preferences",
        page.getByRole("radio", { name: "기본", exact: true }),
      ],
      ["settings", "/account/settings", page.getByLabel("현재 비밀번호")],
      ["records", "/measurements", page.locator(".record-card")],
      [
        "report",
        `/measurements/${record.id}`,
        page.getByRole("region", { name: "측정 상세 리포트" }),
      ],
      [
        "edit",
        `/measurements/${record.id}/edit`,
        page.getByRole("heading", { name: "측정 기록 수정" }),
      ],
      [
        "onboarding",
        "/onboarding",
        page.getByRole("link", { name: "결과표가 있어요" }),
      ],
      [
        "manual",
        "/onboarding/manual",
        page.getByLabel("성별", { exact: true }),
      ],
      [
        "photo",
        "/onboarding/photo",
        page.getByRole("heading", { name: "결과표 사진 선택" }),
      ],
      [
        "saved",
        `/onboarding/complete?record=${record.id}`,
        page.getByRole("heading", { name: "나의 체력을 기록했어요" }),
      ],
      [
        "assessment",
        "/workout?mode=assessment",
        page.getByLabel("만 나이", { exact: true }),
      ],
      [
        "not-found",
        "/desktop-layout-missing",
        page.getByRole("heading", { name: "찾으시는 화면이 없어요" }),
      ],
    ] as const;
    for (const [name, path, ready] of pages) {
      await page.goto(path);
      // Hidden native radios retain their visible label as the interaction surface.
      if (name === "preferences") await expect(ready).toBeChecked();
      else await expect(ready).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await noOverflow(page);
      expect(
        (await page.getByRole("main").boundingBox())!.width,
      ).toBeGreaterThan(560);
      if (width === 1280)
        await page.screenshot({
          path: info.outputPath(`${name}-desktop.png`),
          fullPage: true,
        });
    }
    await page.goto("/measurements/new");
    await expect(page).toHaveURL("/onboarding");
    expect(api.mutations).toEqual([]);
  });
}

test("데스크톱의 메인·운동·프로필·리포트는 기존 내용을 두 열로 배치한다", async ({
  page,
}) => {
  await installDesktopApi(page);
  async function sideBySide(left: string, right: string) {
    await expect(page.locator(left)).toBeVisible();
    await expect(page.locator(right)).toBeVisible();
    const a = (await page.locator(left).boundingBox())!;
    const b = (await page.locator(right).boundingBox())!;
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
  }
  await page.goto("/");
  await sideBySide(
    ".home-mascot-stage",
    '[aria-labelledby="workout-streak-title"]',
  );
  await page.goto("/workout");
  await sideBySide(
    '[aria-labelledby="today-workout-title"]',
    '[aria-labelledby="workout-history-title"]',
  );
  await page.goto("/account");
  await sideBySide(".latest-fitness", ".menu-card");
  await page.locator('a[href="/measurements"]').click();
  await page.locator(".record-card").click();
  await sideBySide(".fitness-radar", '[aria-label="측정 상세 리포트"]');
  await page
    .getByRole("region", { name: "측정 상세 리포트" })
    .locator('summary[aria-label^="유연성"]')
    .click();
  await expect(
    page.getByRole("list", { name: "이전 기준과 현재 등급, 다음 목표" }),
  ).toBeVisible();
  await noOverflow(page);
});

test("데스크톱 로그인·회원가입은 기존 폼과 소개를 나누고 키보드 입력을 유지한다", async ({
  page,
}, info) => {
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({ status: 401, json: { message: "Anonymous" } }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const mode of ["login", "register"]) {
    await page.goto(`/${mode}`);
    const email = page.getByLabel("이메일", { exact: true });
    await expect(email).toBeVisible();
    const introduction = (await page.locator(".intro").boundingBox())!;
    const form = (await page.locator("form").boundingBox())!;
    expect(introduction.x + introduction.width).toBeLessThanOrEqual(form.x);
    await email.focus();
    await page.keyboard.type("desktop@example.test");
    await expect(email).toHaveValue("desktop@example.test");
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath(`${mode}-desktop.png`),
      fullPage: true,
    });
  }
});

test("데스크톱 사진 입력은 결과표와 패널이 겹치지 않고 닫기·확대·재열기를 유지한다", async ({
  page,
}, info) => {
  await installDesktopApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/onboarding/photo");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1280;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 900, 1280);
    context.fillStyle = "#0a2a70";
    context.font = "36px sans-serif";
    context.fillText("국민체력100 결과표 · 검증용", 50, 100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("결과표 파일 선택").setInputFiles({
    name: "desktop-report.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  const panel = page.getByRole("complementary");
  const photo = page.getByRole("region", { name: "결과표 사진", exact: true });
  await expect(panel).toBeVisible();
  const canvas = (await photo.boundingBox())!;
  const fields = (await panel.boundingBox())!;
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(fields.x);
  expect(fields.y + fields.height).toBeLessThanOrEqual(900);
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page.getByRole("button", { name: "입력 패널 닫기" }).click();
  expect((await photo.boundingBox())!.width).toBeGreaterThan(canvas.width);
  await page.getByRole("button", { name: "사진 확대", exact: true }).click();
  await page.getByRole("button", { name: "입력 패널 열기" }).click();
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("25");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("photo-workspace-desktop.png"),
    fullPage: true,
  });
});
