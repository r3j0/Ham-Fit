import { expect, test } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";

const notification = {
  id: "55555555-1111-4111-8111-111111111111",
  groupId: "66666666-1111-4111-8111-111111111111",
  requestId: "77777777-1111-4111-8111-111111111111",
  type: "join_approved",
  createdAt: "2026-09-29T00:00:00Z",
  readAt: null as string | null,
};

test("뒤 페이지의 미확인 알림도 빨간 점으로 표시하며 읽음 저장 후 홈에서 사라진다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  const row = { ...notification };
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has("cursor")
        ? { items: [row], nextCursor: null }
        : {
            items: [{ ...row, id: row.groupId, readAt: row.createdAt }],
            nextCursor: row.groupId,
          },
    }),
  );
  await page.route(`**/api/v1/notifications/${row.id}/read`, (route) => {
    expect(route.request().method()).toBe("PATCH");
    row.readAt = row.createdAt;
    return route.fulfill({ json: row });
  });
  await page.goto("/");
  const bell = page.getByRole("link", { name: "알림", exact: true });
  await expect(bell).toHaveAccessibleDescription("읽지 않은 알림이 있어요");
  await expect(bell.locator(".notification-unread-dot")).toHaveCSS(
    "background-color",
    "rgb(220, 38, 38)",
  );
  const linkBounds = (await bell.boundingBox())!;
  const dotBounds = (await bell
    .locator(".notification-unread-dot")
    .boundingBox())!;
  expect(dotBounds.x).toBeGreaterThan(linkBounds.x + linkBounds.width / 2);
  expect(dotBounds.y).toBeLessThan(linkBounds.y + linkBounds.height / 2);
  await bell.click();
  await page.getByRole("button", { name: "읽음으로 표시" }).click();
  await expect(page.getByText("아직 알림이 없어요.")).toBeVisible();
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(bell).toBeVisible();
  await expect(bell.locator(".notification-unread-dot")).toHaveCount(0);
  await expect(bell).not.toHaveAccessibleDescription("읽지 않은 알림이 있어요");
});

test("새 알림·읽음 상태는 포커스 복귀와 주기 갱신에 반영되고 잘못된 응답은 미확인 상태로 처리한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.clock.install();
  let mode = "empty";
  let requests = 0;
  await page.route("**/api/v1/notifications?*", (route) => {
    requests++;
    if (mode === "failure") return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: {
        items:
          mode === "empty"
            ? []
            : mode === "invalid"
              ? [{ id: notification.id }]
              : [
                  {
                    ...notification,
                    readAt: mode === "read" ? notification.createdAt : null,
                  },
                ],
        nextCursor: null,
      },
    });
  });
  await page.goto("/");
  const bell = page.getByRole("link", { name: "알림", exact: true });
  const dot = bell.locator(".notification-unread-dot");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(dot).toHaveCount(0);
  mode = "unread";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dot).toBeVisible();
  mode = "read";
  await page.clock.fastForward(60000);
  await expect(dot).toHaveCount(0);
  for (const failure of ["failure", "invalid"]) {
    mode = failure;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(bell).toHaveAccessibleDescription(
      "알림 상태를 확인하지 못했어요",
    );
    await expect(dot).toHaveCount(0);
  }
  mode = "unread";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dot).toBeVisible();
});
