import { expect, test } from "@playwright/test";
import { homeGroup, installHomeGroups } from "./home-groups-fixtures";
import { installApi } from "./integration-fixtures";

test("실제 그룹 응답의 닉네임·인원과 가로 스크롤을 표시하고 좌우 슬라이드로 순환한다", async ({
  page,
}, info) => {
  await installApi(page);
  const rows = [homeGroup(1, 2), homeGroup(2, 12), homeGroup(3, 1)];
  rows[1].members[1].nickname = "함께운동하는친구의긴닉네임테스트";
  await installHomeGroups(page, rows);
  await page.route("**/api/v1/groups?*", (route) => {
    const ids = new URL(route.request().url()).searchParams.has("cursor")
      ? [2, 3]
      : [1, 2];
    return route.fulfill({
      json: {
        items: ids.map((i) => ({ ...rows[i - 1], role: "leader" })),
        nextCursor: ids.includes(3) ? null : rows[1].id,
      },
    });
  });
  await page.goto("/");
  const region = page.getByRole("region", { name: "내 그룹의 햄스터" });
  const next = region.getByRole("button", { name: "다음 그룹" }),
    previous = region.getByRole("button", { name: "이전 그룹" });
  await expect(region.getByRole("listitem")).toHaveCount(2);
  await expect(region.getByRole("link")).toHaveAttribute(
    "href",
    `/groups/${rows[0].id}`,
  );
  await expect(region.getByText(rows[0].name, { exact: true })).toBeVisible();
  await expect(
    region.getByText(rows[0].members[1].nickname!, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "그룹 햄스터 예시" }),
  ).toHaveCount(0);
  await next.click();
  await expect(region.getByRole("listitem")).toHaveCount(12);
  await expect(region.getByRole("link")).toHaveAttribute(
    "data-direction",
    "next",
  );
  await expect(region.getByRole("link")).toHaveCSS(
    "animation-duration",
    "0.32s",
  );
  await expect(next).toBeFocused();
  for (const width of [320, 390, 702, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const items = region.getByRole("listitem"),
      first = items.first();
    const image = (await first.getByRole("img").boundingBox())!,
      nickname = (await first.locator("span[title]").boundingBox())!;
    expect(nickname.y).toBeGreaterThanOrEqual(image.y + image.height);
    const firstBox = (await first.boundingBox())!,
      secondBox = (await items.nth(1).boundingBox())!;
    expect(firstBox.y).toBeCloseTo(secondBox.y, 1);
    expect(firstBox.x + firstBox.width).toBeLessThan(secondBox.x);
    const list = region.getByRole("list");
    await list.scrollIntoViewIfNeeded();
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    );
    await list.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(
      items.last().getByText(rows[1].members.at(-1)!.nickname!),
    ).toBeInViewport();
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await list.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(`home-groups-${width}.png`),
      fullPage: true,
    });
  }
  await next.press("Enter");
  await expect(region.getByRole("listitem")).toHaveCount(1);
  await expect(region.getByRole("link")).toHaveAccessibleName(
    `${rows[2].name} 그룹 보기`,
  );
  await next.click();
  await expect(region.getByRole("listitem")).toHaveCount(2);
  await previous.click();
  await expect(region.getByRole("link")).toHaveAttribute(
    "data-direction",
    "previous",
  );
  await expect(region.getByRole("link")).toHaveCSS("animation-name", "none");
  await expect(region.getByText(rows[2].name, { exact: true })).toBeVisible();
  await region.getByRole("link").click();
  await expect(page).toHaveURL(`/groups/${rows[2].id}`);
});

test("빈 그룹·한 그룹·삭제·조회 실패를 구분하고 실패를 빈 목록으로 바꾸지 않는다", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/");
  const region = page.getByRole("region", { name: "내 그룹의 햄스터" });
  await expect(region.getByText("아직 가입한 그룹이 없어요.")).toBeVisible();
  await expect(region.getByRole("img")).toHaveCount(0);
  await expect(region.getByRole("button", { name: /그룹$/ })).toHaveCount(0);
  const row = homeGroup(1, 1);
  row.members[0].nickname = null;
  await installHomeGroups(page, [row]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(region.getByRole("listitem")).toHaveCount(1);
  await expect(
    region.getByText("닉네임 미설정", { exact: true }),
  ).toBeVisible();
  await expect(region.getByRole("button", { name: "다음 그룹" })).toHaveCount(
    0,
  );
  await page.route(`**/api/v1/groups/${row.id}`, (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(region.getByRole("alert")).toBeVisible();
  await expect(region.getByRole("img")).toHaveCount(0);
  await page.route(`**/api/v1/groups/${row.id}`, (route) =>
    route.fulfill({ json: row }),
  );
  await region.getByRole("button", { name: "그룹원 다시 불러오기" }).click();
  await expect(region.getByRole("listitem")).toHaveCount(1);
  await page.route("**/api/v1/groups?*", (route) =>
    route.fulfill({ json: { items: [{ id: row.id }], nextCursor: null } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(region.getByRole("alert")).toContainText(
    "서버 응답을 확인할 수 없어요",
  );
  await expect(region.getByText("아직 가입한 그룹이 없어요.")).toHaveCount(0);
  await installHomeGroups(page, []);
  await region.getByRole("button", { name: "내 그룹 다시 불러오기" }).click();
  await expect(region.getByText("아직 가입한 그룹이 없어요.")).toBeVisible();
});

test("빠른 그룹 전환에서 늦게 도착한 이전 응답을 현재 그룹에 표시하지 않는다", async ({
  page,
}) => {
  await installApi(page);
  const rows = [homeGroup(1, 1), homeGroup(2, 2), homeGroup(3, 3)];
  await installHomeGroups(page, rows);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/groups/${rows[1].id}`, async (route) => {
    await gate;
    await route.fulfill({ json: rows[1] }).catch(() => {});
  });
  await page.goto("/");
  const region = page.getByRole("region", { name: "내 그룹의 햄스터" });
  await expect(region.getByRole("listitem")).toHaveCount(1);
  await region.getByRole("button", { name: "다음 그룹" }).click();
  await expect(region.getByText("그룹원을 불러오고 있어요")).toBeVisible();
  await region.getByRole("button", { name: "다음 그룹" }).click();
  await expect(region.getByRole("listitem")).toHaveCount(3);
  release();
  await expect(region.getByRole("link")).toHaveAttribute(
    "href",
    `/groups/${rows[2].id}`,
  );
  await expect(region.getByText(rows[1].name, { exact: true })).toHaveCount(0);
});
