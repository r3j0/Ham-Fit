import { refreshOnFocus } from "./resource-refresh";
import { expect, test } from "@playwright/test";
import { homeGroup, installHomeGroups } from "./home-groups-fixtures";
import { installApi } from "./integration-fixtures";

for (const status of [400, 404]) {
  test(`구버전 BE의 overview ${status} 응답에서 전체 그룹을 먼저 조회하고 전환에 재사용한다`, async ({
    page,
  }, info) => {
    await installApi(page);
    const rows = [homeGroup(1, 2), homeGroup(2, 2)];
    rows[0].maxMembers = 20;
    // The older detail contract can omit today's completion flag.
    delete rows[0].members[1].todayWorkoutCompleted;
    rows[1].members[1].todayWorkoutCompleted = true;
    await installHomeGroups(page, rows);
    await page.route("**/api/v1/groups/overview", (route) =>
      route.fulfill({
        status,
        json:
          status === 400
            ? {
                statusCode: 400,
                message: "사용자 입력을 확인해 주세요.",
                errors: [{ field: "body", message: "Invalid UUID" }],
              }
            : {
                statusCode: 404,
                message: "Cannot GET /api/v1/groups/overview",
              },
      }),
    );
    const cursors: (string | null)[] = [];
    await page.route("**/api/v1/groups?*", (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      cursors.push(cursor);
      const group = rows[cursor ? 1 : 0];
      return route.fulfill({
        json: {
          items: [{ ...group, role: "leader" }],
          nextCursor: cursor ? null : rows[0].id,
        },
      });
    });
    const calls: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/groups")) calls.push(path);
    });
    await page.goto("/");
    const region = page.getByRole("region", { name: "내 그룹의 햄스터" });
    await expect(
      region.getByText(rows[0].members[1].nickname!, { exact: true }),
    ).toBeVisible();
    await expect(region.getByRole("alert")).toHaveCount(0);
    await expect(region).toContainText("오늘 확인 불가");
    await expect(region.locator(".profile-character")).toHaveCSS(
      "opacity",
      "1",
    );
    expect(cursors).toContain(rows[0].id);
    for (const group of rows)
      expect(calls).toContain(`/api/v1/groups/${group.id}`);
    const initialCalls = calls.length;
    await region.getByRole("button", { name: "다음 그룹" }).click();
    await expect(
      region.getByText(rows[1].members[1].nickname!, { exact: true }),
    ).toBeVisible();
    await expect(region.getByRole("link")).toHaveAttribute(
      "href",
      `/groups/${rows[1].id}`,
    );
    await expect(region.getByText("오늘 확인 불가")).toHaveCount(0);
    await expect(region.locator(".profile-character")).toHaveCSS(
      "opacity",
      "1",
    );
    await region.getByRole("button", { name: "이전 그룹" }).click();
    await expect(region.getByText("오늘 확인 불가")).toBeVisible();
    expect(calls).toHaveLength(initialCalls);
    await region.screenshot({
      path: info.outputPath(`legacy-groups-${status}.png`),
      animations: "disabled",
    });
    // Refresh always probes overview again so a newly deployed BE recovers the fast path.
    rows[0].members[1].todayWorkoutCompleted = false;
    rows[0].maxMembers = 5;
    await installHomeGroups(page, rows);
    const restoredCalls = calls.length;
    await refreshOnFocus(page);
    await expect(region.getByText("오늘 확인 불가")).toHaveCount(0);
    await expect(region.locator(".profile-character")).toHaveCSS(
      "opacity",
      "0.4",
    );
    expect(calls.slice(restoredCalls)).toEqual(["/api/v1/groups/overview"]);
  });
}

for (const status of [400, 403, 503]) {
  test(`overview의 일반 ${status} 오류는 기존 조회로 우회하거나 빈 그룹으로 표시하지 않는다`, async ({
    page,
  }) => {
    await installApi(page);
    await installHomeGroups(page);
    await page.route("**/api/v1/groups/overview", (route) =>
      route.fulfill({
        status,
        json: {
          message: "Other failure",
          errors: [{ field: "body", message: "Other failure" }],
        },
      }),
    );
    let legacyCalls = 0;
    await page.route("**/api/v1/groups?*", (route) => {
      legacyCalls++;
      return route.fulfill({ json: { items: [], nextCursor: null } });
    });
    await page.goto("/");
    const region = page.getByRole("region", { name: "내 그룹의 햄스터" });
    await expect(region.getByRole("alert")).toBeVisible();
    expect(legacyCalls).toBe(0);
    await expect(region.getByRole("link")).toHaveCount(0);
  });
}

test("호환 조회의 그룹 상세 실패는 오류를 유지하고 재시도로 복구한다", async ({
  page,
}) => {
  await installApi(page);
  const row = homeGroup(1, 2);
  await installHomeGroups(page, [row]);
  await page.route("**/api/v1/groups/overview", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  let fail = true;
  await page.route(`**/api/v1/groups/${row.id}`, (route) =>
    route.fulfill(
      fail
        ? {
            status: 503,
            json: {},
          }
        : { json: row },
    ),
  );
  await page.goto("/");
  const region = page.getByRole("region", { name: "내 그룹의 햄스터" });
  await expect(region.getByRole("alert")).toBeVisible();
  await expect(region.getByRole("img")).toHaveCount(0);
  fail = false;
  await region.getByRole("button", { name: "내 그룹 다시 불러오기" }).click();
  await expect(
    region.getByText(row.members[1].nickname!, { exact: true }),
  ).toBeVisible();
});
