import { test, expect } from "@playwright/test";
import { installApi, testRecord, testUser } from "./integration-fixtures";

test("가입 실패는 폼을 유지하고 성공하면 메인 경유 없이 온보딩을 시작한다", async ({
  page,
}, info) => {
  const server = await installApi(page);
  const progress = page.getByRole("progressbar", {
    name: "체력 기록 진행 단계",
  });
  let registered = false;
  let attempts = 0;
  const auth = {
    user: testUser,
    access_token: "test-token",
    expires_in: 900,
    token_type: "Bearer",
  };
  await page.route("**/auth/refresh", (route) =>
    route.fulfill(
      registered
        ? { json: auth }
        : { status: 401, json: { message: "Anonymous" } },
    ),
  );
  await page.route("**/auth/register", (route) => {
    expect(route.request().postDataJSON().dateOfBirth).toBe("2000-02-29");
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 409,
        json: { message: "Email already exists" },
      });
    registered = true;
    return route.fulfill({ status: 201, json: auth });
  });
  const destinations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      destinations.push(new URL(frame.url()).pathname);
  });
  await page.goto("/register?next=%2Faccount");
  await page.getByLabel("생년월일", { exact: true }).fill("2000-02-29");
  await page
    .getByLabel("이메일", { exact: true })
    .fill("duplicate@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("regtest!");
  await page.getByLabel("비밀번호 확인", { exact: true }).fill("regtest!");
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute(
    "minlength",
    "8",
  );
  await page.getByLabel("비밀번호", { exact: true }).fill("1234567");
  await page.getByLabel("비밀번호 확인", { exact: true }).fill("1234567");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  expect(attempts).toBe(0);
  await page.getByLabel("비밀번호", { exact: true }).fill("regtest!");
  await page.getByLabel("비밀번호 확인", { exact: true }).fill("regtest!");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "이미 가입된 이메일",
  );
  await expect(page).toHaveURL("/register?next=%2Faccount");
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveValue(
    "regtest!",
  );
  await page.getByLabel("이메일", { exact: true }).fill(testUser.email);
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL("/welcome");
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toHaveCount(
    0,
  );
  await page.getByLabel("닉네임", { exact: true }).fill("새로운햄스터");
  await page.getByRole("button", { name: "햄콩이", exact: true }).click();
  await page.getByRole("button", { name: "저장하고 다음으로" }).click();
  await expect(page).toHaveURL("/onboarding");
  expect(server.mutations).toEqual([
    {
      path: "/users/me/profile",
      method: "PATCH",
      body: { nickname: "새로운햄스터" },
    },
    {
      path: "/users/me/avatar/outfit",
      method: "PUT",
      body: {
        characterId: "character.gray",
        poseId: "pose.basic",
        clothingIds: [],
      },
    },
  ]);
  server.mutations.length = 0;
  await expect(
    page.getByRole("heading", { name: "체력 기록 시작", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "건너뛰기", exact: true }),
  ).toHaveCount(0);
  await expect(progress).toHaveAttribute("aria-valuenow", "1");
  expect(destinations).not.toContain("/");
  expect(destinations).not.toContain("/account");
  expect(attempts).toBe(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [430, 932],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(page.getByRole("main")).toHaveCSS("padding-bottom", "0px");
    await page.screenshot({
      path: info.outputPath(`onboarding-${width}.png`),
      fullPage: true,
    });
  }
  for (const [name, path] of [
    ["결과표가 있어요", "/onboarding/photo"],
    ["직접 입력하기", "/onboarding/manual"],
    ["결과표가 없어요", "/workout?mode=assessment"],
  ]) {
    // The card padding is clickable, not just its title or icon.
    await page.getByRole("link", { name, exact: true }).click({
      position: { x: 8, y: 8 },
    });
    await expect(page).toHaveURL(path);
    await expect(
      page.getByRole("navigation", { name: "하단 메뉴" }),
    ).toBeHidden();
    await expect(page.getByRole("main")).toHaveCSS("padding-bottom", "0px");
    await expect(progress).toHaveAttribute("aria-valuenow", "2");
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`${name}-${width}.png`),
        fullPage: false,
      });
    }
    await page.goBack();
    await expect(page).toHaveURL("/onboarding");
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await expect(
      page.getByRole("navigation", { name: "하단 메뉴" }),
    ).toHaveCount(0);
  }
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).toBeVisible();
  expect(server.mutations).toEqual([]);
  await page.goBack();
  await page.getByRole("link", { name: "이전 화면", exact: true }).focus();
  for (const name of ["결과표가 있어요", "결과표가 없어요", "직접 입력하기"]) {
    await page.keyboard.press("Tab");
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/onboarding/manual");
  await page.goBack();
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(server.mutations).toEqual([]);

  // Existing users keep their notice and access to previous measurements.
  server.setRecord(testRecord());
  await page.goto("/onboarding");
  await expect(page.getByRole("status")).toContainText("이미 등록한 기록");
  await page
    .getByRole("link", { name: "내 측정 기록 보기", exact: true })
    .click();
  await expect(page).toHaveURL("/measurements");
  await expect(page.locator(".record-card")).toHaveCount(1);
});
