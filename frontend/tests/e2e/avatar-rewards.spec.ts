import { expect, test } from "@playwright/test";
import {
  installCommerce,
  rewardId as id,
  rewardDate as date,
  products as originalProducts,
  shirtAssets,
} from "./avatar-rewards-fixtures";
import { installApi, testUser, testRecord } from "./integration-fixtures";
import { routineFixture } from "../fixtures/routine";
import type { Product } from "../../lib/shop-contract";

test("상점·옷장의 모든 아이템 종류를 작은 화면에서도 4열로 표시한다", async ({
  page,
}, info) => {
  const state = await installCommerce(page);
  const poses = [
    "basic",
    "cant-hear",
    "curious",
    "drink",
    "droopy",
    "foam-roller",
    "lying",
    "run",
  ];
  const products: Product[] = [
    ...originalProducts.filter((p) => p.kind === "character"),
    ...poses.map((renderKey, index) => ({
      ...originalProducts.find(
        (p) => p.kind === "pose" && p.renderKey === "basic",
      )!,
      id: `pose.${renderKey}`,
      renderKey,
      saleStatus: index ? ("on_sale" as const) : ("default" as const),
      price: index ? 70 : null,
      priceProvisional: index > 3,
    })),
    ...(["hat", "top", "bottom"] as const).flatMap((slot) =>
      Array.from({ length: 8 }, (_, i) => ({
        ...originalProducts.find((p) => p.kind === "clothing")!,
        id: `clothing.${slot}.${i}`,
        slot,
        occupiesSlots: [slot],
        renderKey: slot === "top" ? "mint-shirt" : `${slot}-${i}`,
        price: slot === "hat" ? 30 : slot === "top" ? 25 : 20,
        priceProvisional: i > 3,
      })),
    ),
  ];
  await page.route("**/api/v1/shop/products", (route) =>
    route.fulfill({
      json: {
        products,
        combinations: ["cream", "gray"].flatMap((v) =>
          poses.map((pose) => ({
            characterId: `character.${v}`,
            poseId: `pose.${pose}`,
            clothingIds: [],
          })),
        ),
      },
    }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["/shop", "/shop/wardrobe"]) {
    if (route === "/shop/wardrobe")
      state.owned.push(
        ...products.map((p) => p.id).filter((id) => !state.owned.includes(id)),
      );
    await page.goto(route);
    for (const width of [320, 600, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const category of ["모자", "상의", "하의", "자세"]) {
        await page.getByRole("button", { name: category, exact: true }).click();
        const grid = page.locator(".shop-grid");
        await expect(grid.locator(".shop-item")).toHaveCount(8);
        const boxes = await grid.locator(".shop-item").evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, right: r.right };
          }),
        );
        for (let i = 0; i < 4; i++) {
          expect(boxes[i].y).toBeCloseTo(boxes[0].y, 1);
          expect(boxes[i].width).toBeGreaterThanOrEqual(44);
          if (i) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].right);
        }
        expect(boxes[4].y).toBeGreaterThan(boxes[0].y);
        expect(boxes[4].x).toBeCloseTo(boxes[0].x, 1);
        const artwork = await grid
          .locator(".shop-item-art .profile-character")
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const image = node.getBoundingClientRect(),
                frame = node.parentElement!.getBoundingClientRect();
              return {
                left: image.left,
                right: image.right,
                top: image.top,
                bottom: image.bottom,
                frameLeft: frame.left,
                frameRight: frame.right,
                frameTop: frame.top,
                frameBottom: frame.bottom,
              };
            }),
          );
        for (const image of artwork) {
          expect(image.left).toBeGreaterThanOrEqual(image.frameLeft - 1);
          expect(image.right).toBeLessThanOrEqual(image.frameRight + 1);
          expect(image.top).toBeGreaterThanOrEqual(image.frameTop - 1);
          expect(image.bottom).toBeLessThanOrEqual(image.frameBottom + 1);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
      }
      await page.screenshot({
        path: info.outputPath(
          `${route === "/shop" ? "shop" : "wardrobe"}-four-columns-${width}.png`,
        ),
        fullPage: true,
      });
    }
  }
  expect(state.puts).toBe(0);
  expect(state.purchases).toEqual([]);
});

test("구매 응답 유실을 같은 키로 복구하고 구매와 대표 코디 저장을 구분한다", async ({
  page,
}) => {
  const state = await installCommerce(page);
  state.losePurchase = true;
  await page.goto("/shop");
  const balance = page.getByRole("group", { name: "보유 재화" });
  await expect(balance.getByRole("img", { name: "해바라기씨" })).toBeVisible();
  await expect(balance).toHaveText("100");
  await page.getByRole("button", { name: "자세", exact: true }).click();
  await page.getByRole("button", { name: /궁금.*50개/ }).click();
  await page.getByRole("button", { name: /궁금 구매하기/ }).click();
  await page.getByRole("button", { name: "구매 확정", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이전 구매 결과 확인" }),
  ).toBeVisible();
  expect(state.balance).toBe(50);
  expect(state.outfit.poseId).toBe("pose.basic");
  expect(state.puts).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "이전 구매 결과 확인" }).click();
  await expect(
    page.getByText("구매했어요. 내 옷장에서 착용하고 저장할 수 있어요."),
  ).toBeVisible();
  expect(state.purchases).toHaveLength(2);
  expect(state.purchases[0]).toEqual(state.purchases[1]);
  expect(state.balance).toBe(50);
  await page.getByRole("link", { name: "내 옷장", exact: true }).click();
  await expect(balance).toHaveText("50");
  await expect(
    page.getByRole("heading", { name: "내 옷장", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자세", exact: true }).click();
  await page.getByRole("button", { name: /궁금.*보유 중/ }).click();
  await page.getByRole("button", { name: "코디 저장", exact: true }).click();
  await expect(page.getByText("대표 코디를 저장했어요.")).toBeVisible();
  expect(state.outfit.poseId).toBe("pose.curious");
  await page.reload();
  await expect(
    page.getByRole("img", { name: "내 캐릭터 미리보기" }),
  ).toHaveAttribute("data-pose", "curious");
  await page.goto("/account");
  await expect(
    page.getByRole("img", { name: "나의 대표 캐릭터", exact: true }),
  ).toHaveAttribute("data-pose", "curious");
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "나의 대표 캐릭터", exact: true }),
  ).toHaveAttribute("data-pose", "curious");
});
test("상점은 캐릭터 전환을 숨기고 옷장에서만 얼굴 선택을 저장한다", async ({
  page,
}, info) => {
  const state = await installCommerce(page);
  for (const route of ["/shop", "/shop/wardrobe"]) {
    await page.goto(route);
    const choices = page.getByRole("group", { name: "캐릭터 선택" });
    if (route === "/shop") {
      await expect(choices).toHaveCount(0);
      await expect(
        page.getByRole("img", { name: "내 캐릭터 미리보기" }),
      ).toHaveAttribute("data-variant", "cream");
      await expect(page.getByRole("group", { name: "보유 재화" })).toHaveText(
        "100",
      );
      expect(state.puts).toBe(0);
      continue;
    }
    const cream = choices.getByRole("button", {
      name: "햄돌이",
      exact: true,
    });
    const gray = choices.getByRole("button", {
      name: "햄콩이",
      exact: true,
    });
    await expect(choices.getByRole("button")).toHaveCount(2);
    await expect(cream).toHaveText("");
    await expect(gray).toHaveText("");
    await expect(cream.locator("svg")).toHaveAttribute(
      "data-face-variant",
      "cream",
    );
    await expect(gray.locator("svg")).toHaveAttribute(
      "data-face-variant",
      "gray",
    );
    await expect(cream).toHaveAttribute("aria-pressed", "true");
    await gray.focus();
    await page.keyboard.press("Enter");
    await expect(gray).toHaveAttribute("aria-pressed", "true");
    await expect(cream).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("img", { name: "내 캐릭터 미리보기" }),
    ).toHaveAttribute("data-variant", "gray");
    await expect(page.getByText(/현재 대표 코디|미리 보는 중/)).toHaveCount(0);
    await expect(page.getByRole("group", { name: "보유 재화" })).toHaveText(
      "100",
    );
    await expect(page.locator(".shop-balance")).toHaveCount(0);
    expect(state.puts).toBe(0);
    for (const width of [320, 600]) {
      await page.setViewportSize({ width, height: 786 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(
          `${route === "/shop" ? "shop" : "wardrobe"}-${width}.png`,
        ),
        fullPage: true,
      });
    }
  }
  await page.getByRole("button", { name: "코디 저장", exact: true }).click();
  await expect(page.getByText("대표 코디를 저장했어요.")).toBeVisible();
  expect(state.puts).toBe(1);
  expect(state.outfit.characterId).toBe("character.gray");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "햄콩이", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("민트 티셔츠 합성, 햄돌이·햄콩이 전환, 412 충돌과 작은 화면을 검증한다", async ({
  page,
}, info) => {
  const state = await installCommerce(page, true);
  const displayRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /hamsters\/wardrobe|avatar\/(?:assets|render-catalog)/.test(request.url())
    )
      displayRequests.push(request.url());
  });
  await page.goto("/shop/wardrobe");
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page.getByRole("button", { name: /민트 티셔츠.*보유 중/ }).click();
  const layers = page
    .getByRole("img", { name: "내 캐릭터 미리보기" })
    .locator("image");
  await expect(layers).toHaveCount(2);
  await expect(layers.nth(1)).toHaveAttribute(
    "href",
    new RegExp(`${shirtAssets.cream}$`),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const variant of ["햄돌이", "햄콩이"]) {
    await page.getByRole("button", { name: variant, exact: true }).click();
    await expect(layers.nth(1)).toHaveAttribute(
      "href",
      new RegExp(`${shirtAssets[variant === "햄돌이" ? "cream" : "gray"]}$`),
    );
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`wardrobe-${variant}-${width}.png`),
        fullPage: true,
      });
    }
  }
  state.conflict = true;
  await page.getByRole("button", { name: "코디 저장", exact: true }).click();
  await expect(
    page.getByText("저장된 코디가 변경되었어요. 최신 코디를 불러와 주세요."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "코디 저장", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "되돌리기" }).click();
  expect(state.outfit.clothingIds).toEqual([]);
  expect(
    displayRequests.some((url) =>
      url.endsWith("/hamsters/wardrobe/catalog.json"),
    ),
  ).toBe(true);
  expect(
    displayRequests.some((url) =>
      /\/api\/v\d+\/avatar\/(?:assets|render-catalog)/.test(url),
    ),
  ).toBe(false);
});
test("그룹 미션은 성장 모습과 참여 자격을 표시하고 룰렛 응답 유실을 복구한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  const groupId = id(1),
    ticketId = id(2),
    roundId = id(3);
  let started = false,
    eligible = true,
    used = false,
    lose = true;
  const writes: { key: string; body: string }[] = [];
  const draw = {
    id: id(4),
    ticketId,
    roundId,
    drawnAt: date,
    policyVersion: "sunflower-2026-09-30-v1",
    result: "contributors_3",
    amountPerRecipient: 3,
    recipients: [{ userId: testUser.id, amount: 3 }],
    myReward: [{ amount: 3, transactionId: id(5) }],
  };
  const mission = () => ({
    id: roundId,
    groupId,
    status: "in_progress",
    startedAt: date,
    completedAt: null,
    memberCount: 2,
    waterCount: 3,
    totalTarget: 28,
    stage: "sprout",
    stageTargets: { seed: 0, sprout: 2, stem: 6, bud: 14, sunflower: 28 },
    policyVersion: "sunflower-2026-09-30-v1",
    me: {
      eligible,
      reason: eligible ? "eligible" : "not_in_snapshot",
      waterCount: eligible ? 2 : 0,
    },
  });
  await page.route(`**/api/v1/groups/${groupId}**`, (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path.endsWith("/missions/current"))
      return route.fulfill({
        json: started ? mission() : { id: null, status: "not_started" },
      });
    if (path.endsWith("/missions/start")) {
      started = true;
      return route.fulfill({
        status: 201,
        json: { mission: mission(), replayed: false },
      });
    }
    if (path.endsWith("/roulette/tickets"))
      return route.fulfill({
        json: {
          items: [
            {
              id: ticketId,
              roundId,
              createdAt: date,
              policyVersion: "sunflower-2026-09-30-v1",
              status: used ? "used" : "available",
              usable: !used,
              usedAt: used ? date : null,
              invalidatedAt: null,
            },
          ],
          nextCursor: null,
        },
      });
    if (path.endsWith("/roulette/draws"))
      return route.fulfill({
        json: { items: used ? [draw] : [], nextCursor: null },
      });
    if (path.endsWith("/roulette/spins")) {
      writes.push({
        key: req.headers()["idempotency-key"],
        body: req.postData()!,
      });
      used = true;
      if (lose) {
        lose = false;
        return route.abort();
      }
      return route.fulfill({ status: 201, json: { draw, replayed: true } });
    }
    return route.fulfill({
      json: {
        id: groupId,
        name: "함께 운동",
        description: "미션",
        maxMembers: 5,
        currentMembers: 2,
        createdAt: date,
        members: [testUser.id, id(7)].map((userId, i) => ({
          userId,
          nickname: `친구${i}`,
          profileCharacter: null,
          streak: 0,
          role: i ? "member" : "leader",
          joinedAt: date,
        })),
      },
    });
  });
  await page.goto(`/groups/${groupId}`);
  await page.getByRole("button", { name: "새 미션 시작", exact: true }).click();
  await page.getByRole("button", { name: "미션 시작", exact: true }).click();
  await expect(
    page.getByRole("progressbar", { name: "물 주기 달성도" }),
  ).toHaveAttribute("value", "3");
  eligible = false;
  await page.reload();
  await expect(
    page.getByText("미션 시작 후 들어왔어요. 다음 미션부터 참여할 수 있어요."),
  ).toBeVisible();
  await page.route("**/api/v1/groups?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: groupId,
            name: "함께 운동",
            description: "미션",
            maxMembers: 5,
            currentMembers: 2,
            createdAt: date,
            role: "leader",
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto(`/groups/${groupId}`);
  await page
    .getByRole("region", { name: "그룹 룰렛", exact: true })
    .getByRole("link", { name: "룰렛 돌리기" })
    .click();
  await page.getByRole("button", { name: "룰렛 돌리기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이전 추첨 결과 확인" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "그룹으로", exact: true }).click();
  await expect(page.getByLabel("그룹 룰렛 사용 가능 횟수")).toHaveText("0회");
  await page.getByRole("link", { name: "이전 추첨 결과 확인" }).click();
  await expect(page).toHaveURL(`/groups/${groupId}/roulette`);
  await page.reload();
  await page.getByRole("button", { name: "이전 추첨 결과 확인" }).click();
  await expect(page.getByText("내가 받은 해바라기씨 3개")).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
});
test("완료 전 진입을 막고 완료→스트릭→실제 물→실제 씨앗 순서로 이동한다", async ({
  page,
}, info) => {
  test.skip(
    process.env.E2E_PROPOSED_REWARDS !== "true",
    "제안 BE 계약을 켠 별도 테스트 서버에서 실행",
  );
  await installApi(page, testRecord());
  const routine = routineFixture();
  await page.route("**/api/v2/workout-routines/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/history")
        ? { items: [routine], nextCursor: null }
        : routine,
    }),
  );
  await page.route("**/api/v1/users/me/profile/activity", (route) =>
    route.fulfill({
      json: {
        userId: testUser.id,
        nickname: "햄스터",
        profileCharacter: null,
        streak: 5,
      },
    }),
  );
  await page.route("**/api/v1/users/me/activity-rewards?*", (route) =>
    route.fulfill({
      json: {
        routineId: routine.id,
        koreanDate: routine.koreanDate,
        seed: { status: "granted", amount: 1, transactionId: id(21) },
        waters: [
          {
            groupId: id(22),
            groupName: "함께 운동",
            roundId: id(23),
            amount: 1,
          },
        ],
        personalTicketIds: [],
      },
    }),
  );
  await page.route("**/api/v1/users/me/group-mission-water**", (route) =>
    route.fulfill({
      json: {
        sourceKind: "routine",
        sourceId: routine.id,
        koreanDate: routine.koreanDate,
        status: "contributed",
        reason: null,
        options: [],
        contribution: {
          groupId: id(22),
          groupName: "함께 운동",
          roundId: id(23),
          amount: 1,
        },
      },
    }),
  );
  const base = `/workout-routines/${routine.id}/complete`;
  await page.goto(base);
  await expect(page.getByText("아직 마치지 않은 운동이 있어요.")).toBeVisible();
  routine.status = "completed";
  routine.progress.completedItems = 3;
  routine.routine.forEach((i) => {
    i.status = "completed";
    i.resultStatus = "completed";
    i.completedAt = routine.serverTime;
    i.performedAt = routine.serverTime;
    i.progress.watchedSeconds = 48;
    i.progress.intervals = [{ start: 0, end: 48 }];
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "오늘의 운동 완료!" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "현재 5일 연속!" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "함께 운동 그룹에 물을 주었어요!" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("water-receipt.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "다음", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "해바라기씨 1개를 받았어요!" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "메인으로", exact: true }).click();
  await expect(page).toHaveURL("/");
});
for (const kind of ["reps", "hold", "timed"] as const)
  test(`${kind} 선택 수행은 타이머·세트만 진행하며 서버 운동 이벤트를 추가하지 않는다`, async ({
    page,
  }) => {
    const api = await installApi(page, testRecord());
    const routine = routineFixture(),
      item = routine.routine[0];
    item.prescription = {
      doseType: kind,
      value: "2",
      unit: kind === "reps" ? "회" : kind === "hold" ? "초 유지" : "초",
      sets: 2,
      restSec: 1,
      text: "테스트 처방",
    };
    await page.route("**/api/v2/workout-routines/**", (route) =>
      route.fulfill({
        json: route.request().url().includes("/history")
          ? { items: [], nextCursor: null }
          : routine,
      }),
    );
    await page.goto(
      `/workout-routines/${routine.id}/items/${item.id}/practice`,
    );
    await page.getByRole("button", { name: "세트 시작", exact: true }).click();
    if (kind === "reps") {
      await page.getByRole("button", { name: "1회 했어요" }).click();
      await expect(
        page.getByRole("button", { name: "이번 세트 완료" }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "1회 했어요" }).click();
      await page.getByRole("button", { name: "이번 세트 완료" }).click();
    }
    await expect(page.getByText("1 / 2세트 · 쉬는 시간")).toBeVisible();
    await page.getByRole("button", { name: "휴식 마치고 다음 세트" }).click();
    await page.getByRole("button", { name: "세트 시작", exact: true }).click();
    if (kind === "reps") {
      await page.getByRole("button", { name: "1회 했어요" }).click();
      await page.getByRole("button", { name: "1회 했어요" }).click();
      await page.getByRole("button", { name: "이번 세트 완료" }).click();
    }
    await expect(
      page.getByRole("heading", { name: "2세트 모두 마쳤어요!" }),
    ).toBeVisible();
    expect(api.mutations).toEqual([]);
    await expect(
      page.getByRole("link", { name: "영상으로 돌아가 완료하기" }),
    ).toBeVisible();
  });
