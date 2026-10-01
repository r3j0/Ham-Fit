import { test, expect, type Page } from "@playwright/test";
import { installApi, testUser } from "./integration-fixtures";

const groupId = "77777777-1111-4111-8111-111111111111";
const otherId = "88888888-1111-4111-8111-111111111111";
const thirdId = "99999999-1111-4111-8111-111111111111";
async function setup(page: Page, leader = true) {
  await installApi(page);
  const state = {
    members: [testUser.id, otherId, thirdId].map((userId, index) => ({
      userId,
      nickname: index ? "그룹원" + index : "그룹장",
      role: (leader ? index === 0 : index === 2) ? "leader" : "member",
      profileCharacter: null,
      streak: 0,
      joinedAt: "2026-09-29T00:00:00Z",
    })),
    writes: [] as { method: string; path: string; body: unknown }[],
    fail: false,
  };
  await page.route(`**/api/v1/groups/${groupId}**`, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      state.writes.push({
        method: request.method(),
        path,
        body: request.postDataJSON(),
      });
      expect(request.headers()["x-csrf-protection"]).toBe("1");
      if (state.fail)
        return route.fulfill({
          status: 409,
          json: { message: "다른 곳에서 그룹이 변경됐어요." },
        });
      if (path.endsWith("/leadership")) {
        state.members.forEach(
          (member) =>
            (member.role = member.userId === otherId ? "leader" : "member"),
        );
      } else
        state.members = state.members.filter(
          (member) => member.userId !== otherId,
        );
      return route.fulfill({ status: 204 });
    }
    if (path.includes("/members/"))
      return route.fulfill({
        json: state.members.find(
          (member) => member.userId === path.split("/").at(-1),
        ),
      });
    if (path.endsWith("/missions/current"))
      return route.fulfill({ json: { id: null, status: "not_started" } });
    return route.fulfill({
      json: {
        id: groupId,
        name: "관리 확인 그룹",
        description: "",
        maxMembers: 5,
        currentMembers: state.members.length,
        createdAt: "2026-09-29T00:00:00Z",
        members: state.members,
      },
    });
  });
  return state;
}

for (const action of ["그룹장 위임", "내보내기"]) {
  test(`프로필 하단에서 ${action}를 확인하고 실행하면 그룹 목록을 갱신한다`, async ({
    page,
  }, info) => {
    const state = await setup(page);
    await page.setViewportSize({ width: 559, height: 900 });
    await page.goto(`/groups/${groupId}`);
    await expect(
      page.getByRole("button", { name: /그룹원1 관리/ }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "그룹원1", exact: true }).click();
    const controls = page.getByRole("region", { name: "그룹원 관리" });
    await expect(controls).toBeVisible();
    const card = await page
      .getByRole("region", { name: "그룹원1", exact: true })
      .boundingBox();
    const stats = await page
      .getByRole("heading", { name: "함께 운동한 기록" })
      .boundingBox();
    const box = await controls.boundingBox();
    expect(box!.y).toBeGreaterThan(stats!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(card!.y + card!.height);
    await controls.getByRole("button", { name: action, exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "취소", exact: true })
      .click();
    expect(state.writes).toHaveLength(0);
    await controls.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("member-actions.png") });
    await controls.getByRole("button", { name: action, exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "확인", exact: true })
      .click();
    await expect(page).toHaveURL(`/groups/${groupId}`);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].method).toBe(
      action === "그룹장 위임" ? "POST" : "DELETE",
    );
    if (action === "그룹장 위임") {
      expect(state.writes[0].body).toEqual({ userId: otherId });
      await expect(
        page.getByRole("button", { name: "가입 신청 관리" }),
      ).toHaveCount(0);
    } else
      await expect(
        page.getByRole("link", { name: "그룹원1", exact: true }),
      ).toHaveCount(0);
  });
}

test("일반 그룹원과 자기 프로필에서는 관리 기능을 표시하지 않는다", async ({
  page,
}) => {
  await setup(page);
  await page.goto(`/groups/${groupId}/members/${testUser.id}`);
  await expect(
    page.getByRole("heading", { name: "그룹원 프로필" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "그룹원 관리" })).toHaveCount(
    0,
  );
  await setup(page, false);
  await page.goto(`/groups/${groupId}/members/${otherId}`);
  await expect(
    page.getByRole("heading", { name: "그룹원1", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "그룹원 관리" })).toHaveCount(
    0,
  );
});

test("서버가 관리 요청을 거절하면 오류와 확인창을 유지한다", async ({
  page,
}) => {
  const state = await setup(page);
  state.fail = true;
  await page.goto(`/groups/${groupId}/members/${otherId}`);
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "확인", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(`/groups/${groupId}/members/${otherId}`);
  expect(state.members).toHaveLength(3);
});
