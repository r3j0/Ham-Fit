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
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "내 그룹", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "내 프로필", exact: true }),
  ).not.toHaveAttribute("aria-current");
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

test("그룹 생성과 초대 가입은 좁은 화면에서도 두 열로 배치하고 입력과 버튼 접근을 유지한다", async ({
  page,
}, info) => {
  await installApi(page);
  await page.route("**/api/v1/groups?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/groups");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const create = page.getByRole("region", { name: "그룹 만들기", exact: true });
  const join = page.getByRole("region", {
    name: "초대 코드로 가입 신청",
    exact: true,
  });
  await create.getByLabel("그룹 이름").fill("함께 움직이기");
  await create.getByLabel("그룹 소개").fill("매일 조금씩 운동해요");
  await join.getByLabel("초대 코드", { exact: true }).fill("a".repeat(43));
  for (const width of [320, 390, 702, 1280]) {
    await page.setViewportSize({ width, height: 786 });
    const left = (await create.boundingBox())!,
      right = (await join.boundingBox())!;
    expect(left.y).toBeCloseTo(right.y, 1);
    expect(left.x + left.width).toBeLessThan(right.x);
    expect(left.width).toBeCloseTo(right.width, 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    for (const region of [create, join]) {
      const button = region.getByRole("button");
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await button.scrollIntoViewIfNeeded();
      await button.click({ trial: true });
    }
    await page.screenshot({
      path: info.outputPath(`group-forms-${width}.png`),
      fullPage: true,
    });
  }
  await expect(create.getByLabel("그룹 이름")).toHaveValue("함께 움직이기");
  await expect(join.getByLabel("초대 코드", { exact: true })).toHaveValue(
    "a".repeat(43),
  );
});
