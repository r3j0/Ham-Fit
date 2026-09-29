import { test, expect } from "@playwright/test";
import { installApi, testUser } from "./integration-fixtures";
const id = "77777777-1111-4111-8111-111111111111";
const group = {
  id,
  name: "복원 그룹",
  description: "저장된 소개",
  maxMembers: 10,
  currentMembers: 1,
  createdAt: "2026-09-29T00:00:00Z",
  role: "leader",
};
test("생성 응답 유실 후 입력과 요청 키를 유지해 새로고침에서도 같은 그룹을 복원한다", async ({
  page,
}) => {
  await installApi(page);
  const requests: { key: string; body: string }[] = [];
  let fail = true;
  await page.route("**/api/v1/groups**", (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (req.method() === "POST" && url.pathname === "/api/v1/groups") {
      requests.push({
        key: req.headers()["idempotency-key"],
        body: req.postData()!,
      });
      expect(req.headers()["x-csrf-protection"]).toBe("1");
      return fail ? route.abort() : route.fulfill({ status: 201, json: group });
    }
    if (url.pathname === `/api/v1/groups/${id}`)
      return route.fulfill({
        json: {
          ...group,
          members: [
            {
              userId: testUser.id,
              nickname: null,
              profileCharacter: null,
              streak: 0,
              role: "leader",
              joinedAt: group.createdAt,
            },
          ],
        },
      });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto("/groups");
  await page.getByLabel("그룹 이름", { exact: true }).fill(group.name);
  await page.getByLabel("그룹 소개", { exact: true }).fill(group.description);
  await page.getByRole("button", { name: "그룹 만들기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이전 요청 확인하기" }),
  ).toBeVisible();
  await page.reload();
  fail = false;
  await page.getByRole("button", { name: "이전 요청 확인하기" }).click();
  await expect(page).toHaveURL(`/groups/${id}`);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(JSON.parse(requests[1].body)).toEqual({
    name: group.name,
    description: group.description,
    maxMembers: 10,
  });
});
test("권한 변경은 화면 복귀 시 반영되며 실패·잘못된 응답은 빈 그룹으로 오인시키지 않는다", async ({
  page,
}) => {
  await installApi(page);
  let leader = true;
  const other = "88888888-1111-4111-8111-111111111111";
  await page.route(`**/api/v1/groups/${id}`, (route) =>
    route.fulfill({
      json: {
        ...group,
        currentMembers: 2,
        members: [
          {
            userId: testUser.id,
            nickname: "나",
            profileCharacter: null,
            streak: 0,
            role: leader ? "leader" : "member",
            joinedAt: group.createdAt,
          },
          {
            userId: other,
            nickname: "다른 그룹원",
            profileCharacter: null,
            streak: 0,
            role: leader ? "member" : "leader",
            joinedAt: group.createdAt,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/v1/groups/${id}/join-requests?*`, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto(`/groups/${id}`);
  await expect(page.getByRole("button", { name: "그룹장 위임" })).toBeVisible();
  leader = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "그룹장 위임" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "그룹 삭제" })).toHaveCount(0);
  await page.route("**/api/v1/groups?*", (route) =>
    route.fulfill({ json: { items: [{ id }], nextCursor: null } }),
  );
  await page.goto("/groups");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버 응답을 확인할 수 없어요",
  );
  await expect(page.getByText("아직 가입한 그룹이 없어요.")).toHaveCount(0);
});
