import { expect, test, type Page } from "@playwright/test";
import { installApi, testRecord, testWorkout } from "./integration-fixtures";

async function expectBottomMenu(page: Page, current: string) {
  const nav = page.getByRole("navigation", { name: "하단 메뉴" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveText(["", "", "", ""]);
  expect(
    await nav
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("aria-label")),
      ),
  ).toEqual(["운동", "메인", "내 그룹", "내 프로필"]);
  await expect(
    nav.getByRole("link", { name: current, exact: true }),
  ).toHaveAttribute("aria-current", /page|location/);
  const box = (await nav.boundingBox())!;
  expect(box.x).toBeCloseTo(0, 1);
  expect(box.width).toBeCloseTo(page.viewportSize()!.width, 1);
  expect(box.y + box.height).toBeCloseTo(page.viewportSize()!.height, 1);
  await expect(nav).toHaveCSS("position", "fixed");
  for (const label of ["메인", "운동", "내 그룹", "내 프로필"]) {
    const link = nav.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    const target = (await link.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.y).toBeGreaterThanOrEqual(box.y);
    expect(target.y + target.height).toBeLessThanOrEqual(box.y + box.height);
  }
  const main = page.getByRole("main");
  const reserve = await main.evaluate((el) =>
    parseFloat(getComputedStyle(el).paddingBottom),
  );
  expect(reserve).toBeGreaterThanOrEqual(box.height);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const [width, height] of [
  [320, 640],
  [390, 844],
  [1280, 900],
]) {
  test(`${width}px 아이콘 메뉴는 하단에 고정되고 원형 메인 강조·키보드 이동·저장 버튼 접근을 유지한다`, async ({
    page,
  }, info) => {
    const record = testRecord();
    const api = await installApi(page, record);
    await page.route("**/api/v1/groups?*", (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    );
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const [path, current] of [
      ["/", "메인"],
      ["/workout", "운동"],
      ["/workouts", "운동"],
      [`/workouts/${testWorkout.id}`, "운동"],
      [`/workouts/${testWorkout.id}/replay`, "운동"],
      ["/workouts/history/2026-09-27", "운동"],
      ["/account", "내 프로필"],
      ["/groups", "내 그룹"],
      ["/account/settings", "내 프로필"],
      ["/account/settings?tab=nickname", "내 프로필"],
      ["/account/settings?tab=birth", "내 프로필"],
      ["/account/preferences", "내 프로필"],
      ["/account/workouts", "내 프로필"],
      ["/account/workouts/history/2026-09-27", "내 프로필"],
      [`/account/workouts/${testWorkout.id}/replay`, "내 프로필"],
      ["/measurements", "내 프로필"],
      [`/measurements/${record.id}`, "내 프로필"],
    ]) {
      await page.goto(path);
      await expectBottomMenu(page, current);
      if (current === "내 프로필") {
        await expect(page.getByRole("main")).toHaveCSS(
          "color",
          "rgb(51, 37, 28)",
        );
        const profileNav = page.getByRole("navigation", { name: "하단 메뉴" });
        await expect(profileNav).toHaveCSS(
          "background-color",
          "rgb(255, 248, 241)",
        );
        const center = profileNav
          .getByRole("link", { name: "메인", exact: true })
          .locator(".bottom-tab-icon");
        await expect(center).toHaveCSS(
          "background-color",
          "rgb(226, 232, 240)",
        );
        await expect(center).toHaveCSS("color", "rgb(100, 116, 139)");
        const activeIcon = profileNav
          .getByRole("link", { name: "내 프로필", exact: true })
          .locator("svg");
        await expect(activeIcon).toHaveCSS("fill", "rgb(255, 127, 0)");
      }
    }
    await page.goto(`/measurements/${record.id}/edit`);
    const save = page.getByRole("button", {
      name: "수정 내용 저장",
      exact: true,
    });
    await expect(save).toBeVisible();
    await save.scrollIntoViewIfNeeded();
    await expectBottomMenu(page, "내 프로필");
    const nav = page.getByRole("navigation", { name: "하단 메뉴" });
    const footer = (await nav.boundingBox())!;
    const action = (await save.boundingBox())!;
    expect(action.y + action.height).toBeLessThanOrEqual(footer.y);
    await save.click({ trial: true });

    const home = nav.getByRole("link", { name: "메인", exact: true });
    const workout = nav.getByRole("link", { name: "운동", exact: true });
    const account = nav.getByRole("link", { name: "내 프로필", exact: true });
    const group = nav.getByRole("link", { name: "내 그룹", exact: true });
    await home.focus();
    await home.press("Enter");
    await expect(page).toHaveURL("/");
    await expectBottomMenu(page, "메인");
    const circle = home.locator(".bottom-tab-icon");
    await expect(circle).toHaveCSS("border-radius", "50%");
    const circleBox = (await circle.boundingBox())!;
    expect(circleBox.width).toBe(circleBox.height);
    expect((await home.locator("svg").boundingBox())!.width).toBeGreaterThan(
      (await workout.locator("svg").boundingBox())!.width,
    );
    await expect(nav).toHaveCSS("background-color", "rgb(240, 242, 246)");
    await expect(circle).toHaveCSS("background-color", "rgb(10, 42, 112)");
    await expect(home.locator("svg")).toHaveCSS("fill", "rgb(255, 255, 255)");
    for (const inactive of [workout, group, account]) {
      await expect(inactive.locator(".bottom-tab-icon")).toHaveCSS(
        "color",
        "rgb(148, 163, 184)",
      );
      await expect(inactive.locator("svg")).toHaveCSS("fill", "none");
    }
    await workout.focus();
    await page.keyboard.press("Tab");
    await expect(home).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(workout).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/workout");
    await expect(nav).toHaveCSS("background-color", "rgb(243, 250, 253)");
    await expect(workout.locator(".bottom-tab-icon")).toHaveCSS(
      "color",
      "rgb(27, 153, 196)",
    );
    await expect(workout.locator("svg")).toHaveCSS("fill", "rgb(27, 153, 196)");
    await expect(circle).toHaveCSS("background-color", "rgb(226, 232, 240)");
    await expect(account.locator(".bottom-tab-icon")).toHaveCSS(
      "color",
      "rgb(148, 163, 184)",
    );
    await expect(account.locator("svg")).toHaveCSS("fill", "none");
    await account.click();
    await expectBottomMenu(page, "내 프로필");
    await expect(nav).toHaveCSS("background-color", "rgb(255, 248, 241)");
    await expect(account.locator("svg")).toHaveCSS("fill", "rgb(255, 127, 0)");
    await expect(workout.locator(".bottom-tab-icon")).toHaveCSS(
      "color",
      "rgb(148, 163, 184)",
    );
    await expect(workout.locator("svg")).toHaveCSS("fill", "none");
    await page.goBack();
    await expectBottomMenu(page, "운동");
    await page.goForward();
    await expectBottomMenu(page, "내 프로필");
    await expect(page.locator('.menu-card a[href="/groups"]')).toHaveCount(0);
    await expect(
      page.locator('.menu-card a[href="/account/notifications"]'),
    ).toHaveCount(0);
    await expect(page.getByText(/연속 운동에는 기존 운동 이력이/)).toHaveCount(
      0,
    );
    await group.click();
    await expect(page).toHaveURL("/groups");
    await expectBottomMenu(page, "내 그룹");
    await expect(account).not.toHaveAttribute("aria-current");
    await expect(group.locator("svg")).toHaveCSS("fill", "rgb(255, 127, 0)");
    await group.focus();
    await page.keyboard.press("Tab");
    await expect(account).toBeFocused();
    await home.click();
    const bell = page
      .getByRole("main")
      .getByRole("link", { name: "알림", exact: true });
    await expect(bell).toBeVisible();
    const toolbar = (await page.locator(".home-toolbar").boundingBox())!;
    const bellBox = (await bell.boundingBox())!;
    expect(bellBox.x + bellBox.width).toBeCloseTo(toolbar.x + toolbar.width, 1);
    await expect(
      page.getByText("그룹 알림 확인하기", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("내 그룹과 함께 운동하기", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/연속 운동에는 기존 운동 이력이/)).toHaveCount(
      0,
    );
    const mascots = page
      .getByRole("region", { name: "내 그룹의 햄스터" })
      .getByRole("link", { name: "그룹 만들기·가입하기", exact: true });
    await expect(
      page.getByRole("region", { name: "내 그룹의 햄스터" }).getByRole("img"),
    ).toHaveCount(0);
    await mascots.focus();
    await mascots.press("Enter");
    await expect(page).toHaveURL("/groups");
    await home.click();
    await bell.click();
    await expect(page).toHaveURL("/account/notifications");
    await page.getByRole("link", { name: "이전 화면", exact: true }).click();
    await expect(page).toHaveURL("/");
    await page.screenshot({ path: info.outputPath(`navigation-${width}.png`) });

    for (const path of [
      "/onboarding",
      "/onboarding/manual",
      "/workout?mode=assessment",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(nav).toBeHidden();
      expect(
        await page
          .getByRole("main")
          .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
      ).toBe(0);
    }
    expect(api.mutations).toEqual([]);
  });
}
