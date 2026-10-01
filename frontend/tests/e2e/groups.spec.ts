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
  for (const invalid of ["", "0", "101"]) {
    await page.getByLabel("정원", { exact: true }).fill(invalid);
    await page
      .getByRole("button", { name: "그룹 만들기", exact: true })
      .click();
    expect(requests).toHaveLength(0);
  }
  await page.getByLabel("정원", { exact: true }).fill("10");
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
  await page.getByRole("button", { name: "다른 그룹원 관리" }).click();
  await expect(page.getByRole("button", { name: "그룹장 위임" })).toBeVisible();
  leader = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "그룹장 위임" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "그룹 설정" }).click();
  await expect(page.getByRole("dialog").getByLabel("그룹 이름")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "그룹 탈퇴" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "그룹 삭제" })).toHaveCount(0);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
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
  await expect(create.getByLabel("그룹 이름")).toHaveAttribute(
    "placeholder",
    "이름",
  );
  await expect(create.getByLabel("그룹 소개")).toHaveAttribute(
    "placeholder",
    "소개",
  );
  await expect(create.getByLabel("정원", { exact: true })).toHaveAttribute(
    "placeholder",
    "정원 (최소 1, 최대 100)",
  );
  await expect(create.getByLabel("정원", { exact: true })).toHaveValue("");
  await expect(page.getByText(/그룹장을 포함해 최대 100명/)).toHaveCount(0);
  await create.getByLabel("그룹 이름").fill("함께 움직이기");
  await create.getByLabel("그룹 소개").fill("매일 조금씩 운동해요");
  await join.getByLabel("초대 코드", { exact: true }).fill("a".repeat(43));
  for (const width of [320, 390, 702, 1280, 1456]) {
    await page.setViewportSize({ width, height: 786 });
    const left = (await create.boundingBox())!,
      right = (await join.boundingBox())!;
    const mascot = page.getByRole("img", { name: "핸드폰을 보는 햄돌이" });
    await expect(mascot).toHaveAttribute("data-pose", "phone");
    await expect(mascot).toHaveAttribute("data-variant", "cream");
    const art = (await mascot.boundingBox())!,
      frame = (await mascot.locator("..").boundingBox())!;
    expect(art.width).toBeCloseTo(115.2, 1);
    expect(art.height).toBeCloseTo(115.2, 1);
    expect(art.x + art.width / 2).toBeCloseTo(frame.x + frame.width / 2, 1);
    expect(
      await create.evaluate((el) =>
        parseFloat(getComputedStyle(el.parentElement!).paddingLeft),
      ),
    ).toBeGreaterThanOrEqual(16);
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

test("그룹원과 신청을 한 행에 표시하며 오늘 상태를 검증하고 설정 안에서만 탈퇴·삭제한다", async ({
  page,
}, info) => {
  await installApi(page);
  const other = "88888888-1111-4111-8111-111111111111";
  const members = [
    {
      userId: testUser.id,
      nickname: "아주 긴 그룹장 닉네임",
      role: "leader",
      streak: 5,
      todayWorkoutCompleted: true,
      profileCharacter: null,
      joinedAt: group.createdAt,
    },
    {
      userId: other,
      nickname: "다른 그룹원",
      role: "member",
      streak: 2,
      todayWorkoutCompleted: false,
      profileCharacter: null,
      joinedAt: group.createdAt,
    },
  ];
  await page.route(`**/api/v1/groups/${id}`, (route) =>
    route.fulfill({ json: { ...group, currentMembers: 2, members } }),
  );
  await page.route(`**/api/v1/groups/${id}/join-requests?*`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "99999999-1111-4111-8111-111111111111",
            groupId: id,
            userId: other,
            nickname: "가입 신청 닉네임이 길어요",
            createdAt: group.createdAt,
            processedAt: null,
            status: "pending",
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto(`/groups/${id}`);
  const region = page.getByRole("region", { name: "그룹원", exact: true });
  await expect(region.getByRole("img", { name: "그룹장" })).toHaveCount(1);
  await expect(
    region.getByText("오늘 운동 완료", { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByText("오늘 운동 미완료", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/연속 운동은 서버 집계 기준/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "그룹 탈퇴", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "그룹 삭제", exact: true }),
  ).toHaveCount(0);
  for (const width of [320, 390, 702, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const row = region.getByRole("listitem").last(),
      name = row.getByRole("link");
    const hamster = (await row.locator(".profile-character").boundingBox())!;
    expect(hamster.width).toBeCloseTo(36 * 1.4, 1);
    expect(hamster.height).toBeCloseTo(36 * 1.4, 1);
    await expect(name).toHaveCSS("text-decoration-line", "none");
    const boxes = await row.evaluate((el) =>
      [...el.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return {
          x: rect.x,
          right: rect.right,
          centerY: rect.y + rect.height / 2,
        };
      }),
    );
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].centerY).toBeCloseTo(boxes[0].centerY, 1);
      expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].right);
    }
    await expect(row).toHaveCSS("border-top-width", "0px");
    const application = page
      .getByRole("region", { name: "가입 신청 관리" })
      .getByRole("listitem");
    const nickname = (await application.locator("strong").boundingBox())!,
      meta = (await application.locator("p").boundingBox())!,
      approve = (await application
        .getByRole("button", { name: "가입 승인" })
        .boundingBox())!;
    expect(nickname.x + nickname.width).toBeLessThanOrEqual(meta.x);
    expect(meta.x + meta.width).toBeLessThanOrEqual(approve.x);
    expect(nickname.y + nickname.height / 2).toBeCloseTo(
      meta.y + meta.height / 2,
      1,
    );
    expect(approve.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`group-rows-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "그룹 설정" }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("그룹 설정");
  await expect(
    page.getByRole("button", { name: "그룹 탈퇴", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "그룹 삭제", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "그룹 삭제", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("그룹 설정");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByRole("button", { name: "그룹 설정" })).toBeFocused();
  delete (members[0] as { todayWorkoutCompleted?: boolean })
    .todayWorkoutCompleted;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    region.getByText("오늘 확인 불가", { exact: true }),
  ).toBeVisible();
  await page.route(`**/api/v1/groups/${id}`, (route) =>
    route.fulfill({
      json: {
        ...group,
        currentMembers: 2,
        members: [
          { ...members[0], todayWorkoutCompleted: "false" },
          members[1],
        ],
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버 응답을 확인할 수 없어요",
  );
});
