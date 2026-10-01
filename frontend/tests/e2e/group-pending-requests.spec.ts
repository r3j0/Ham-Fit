import { test, expect } from "@playwright/test";
import { installApi, testUser } from "./integration-fixtures";

const id = "77777777-1111-4111-8111-111111111111";

test("가입 신청 관리는 대기 요청만 조회·표시하고 승인과 거절 뒤 목록을 갱신한다", async ({
  page,
}) => {
  await installApi(page);
  await page.route(`**/api/v1/groups/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        name: "함께 운동",
        description: "",
        maxMembers: 10,
        currentMembers: 1,
        createdAt: "2026-09-29T00:00:00Z",
        members: [
          {
            userId: testUser.id,
            nickname: "그룹장",
            profileCharacter: null,
            streak: 0,
            role: "leader",
            joinedAt: "2026-09-29T00:00:00Z",
          },
        ],
      },
    }),
  );
  const requests = ["pending", "pending", "approved", "rejected"].map(
    (status, i) => ({
      id: `99999999-1111-4111-8111-11111111111${i}`,
      groupId: id,
      userId: testUser.id,
      nickname: ["승인할 신청", "거절할 신청", "승인된 신청", "거절된 신청"][i],
      createdAt: "2026-09-29T00:00:00Z",
      processedAt: status === "pending" ? null : "2026-09-30T00:00:00Z",
      status,
    }),
  );
  const statuses: string[] = [];
  await page.route(`**/api/v1/groups/${id}/join-requests**`, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      statuses.push(url.searchParams.get("status")!);
      return route.fulfill({ json: { items: requests, nextCursor: null } });
    }
    const [requestId, action] = url.pathname.split("/").slice(-2);
    expect(route.request().headers()["x-csrf-protection"]).toBe("1");
    const request = requests.find((request) => request.id === requestId)!;
    request.status = action === "approve" ? "approved" : "rejected";
    request.processedAt = "2026-10-02T00:00:00Z";
    return route.fulfill({ status: 204 });
  });
  await page.goto(`/groups/${id}`);
  const applications = page.getByRole("region", { name: "가입 신청 관리" });
  await expect(applications.getByRole("listitem")).toHaveCount(2);
  await expect(
    applications.getByRole("group", { name: "신청 상태" }),
  ).toHaveCount(0);
  await expect(applications).not.toContainText("승인된 신청");
  await expect(applications).not.toContainText("거절된 신청");
  await applications
    .getByRole("listitem")
    .filter({ hasText: "승인할 신청" })
    .getByRole("button", { name: "가입 승인" })
    .click();
  await expect(applications.getByRole("listitem")).toHaveCount(1);
  await applications.getByRole("button", { name: "가입 거절" }).click();
  await expect(
    applications.getByText("대기 중인 신청이 없어요."),
  ).toBeVisible();
  await expect(applications.getByRole("listitem")).toHaveCount(0);
  expect(statuses.length).toBeGreaterThanOrEqual(3);
  expect(new Set(statuses)).toEqual(new Set(["pending"]));
});
