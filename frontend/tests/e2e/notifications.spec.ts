import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";
test("알림 페이지 병합, 읽음 저장 실패와 재시도, 잘못된 응답을 구분한다", async ({
  page,
}) => {
  await installApi(page);
  const row = {
    id: "55555555-1111-4111-8111-111111111111",
    groupId: "66666666-1111-4111-8111-111111111111",
    requestId: "77777777-1111-4111-8111-111111111111",
    type: "join_approved",
    createdAt: "2026-09-29T00:00:00Z",
    readAt: null as string | null,
  };
  let fail = true;
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has("cursor")
        ? {
            items: [
              row,
              {
                ...row,
                id: "88888888-1111-4111-8111-111111111111",
                type: "join_rejected",
              },
            ],
            nextCursor: null,
          }
        : { items: [row], nextCursor: row.id },
    }),
  );
  await page.route(`**/api/v1/notifications/${row.id}/read`, (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().headers()["x-csrf-protection"]).toBe("1");
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: {} });
    }
    row.readAt = "2026-09-29T01:00:00Z";
    return route.fulfill({ json: row });
  });
  await page.goto("/account/notifications");
  await expect(page.getByRole("listitem")).toHaveCount(2);
  const approved = page
    .getByRole("listitem")
    .filter({ hasText: "가입이 승인됐어요" });
  await approved.getByRole("button", { name: "읽음으로 표시" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(approved.getByText("읽지 않음", { exact: true })).toBeVisible();
  await approved.getByRole("button", { name: "읽음으로 표시" }).click();
  await expect(approved.getByText("읽음", { exact: true })).toBeVisible();
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({ json: { items: [{ id: row.id }], nextCursor: null } }),
  );
  await page.getByRole("button", { name: "알림 새로고침" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버 응답을 확인할 수 없어요",
  );
  await expect(page.getByText("아직 알림이 없어요.")).toHaveCount(0);
});
