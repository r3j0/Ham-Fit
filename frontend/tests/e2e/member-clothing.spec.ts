import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  installApi,
  testRecord,
  testOutfit,
  testUser,
} from "./integration-fixtures";
import { installCommerce, shirtAssets } from "./avatar-rewards-fixtures";
import { homeGroup, installHomeGroups } from "./home-groups-fixtures";
import { routineFixture } from "../fixtures/routine";
import type { AvatarOutfit } from "../../lib/avatar-outfit";
import catalog from "../../public/hamsters/wardrobe/catalog.json";

function dressed(variant: "cream" | "gray"): AvatarOutfit {
  const clothing: AvatarOutfit["rendering"]["clothing"] = [
    {
      productId: "clothing.beige-hat",
      slot: "hat",
      renderKey: "beige-hat",
      occupiesSlots: ["hat"],
    },
    {
      productId: "clothing.mint-shirt",
      slot: "top",
      renderKey: "mint-shirt",
      occupiesSlots: ["top"],
    },
    {
      productId: "clothing.navy-shorts",
      slot: "bottom",
      renderKey: "navy-shorts",
      occupiesSlots: ["bottom"],
    },
  ];
  return {
    ...testOutfit,
    characterId: `character.${variant}`,
    clothingIds: clothing.map((i) => i.productId),
    rendering: { variant, pose: "basic", clothing },
  };
}
async function assertClothes(mascot: Locator, variant: string, pose: string) {
  await expect(mascot).toBeVisible();
  await expect(mascot).toHaveAttribute("data-variant", variant);
  await expect(mascot).toHaveAttribute("data-pose", pose);
  await expect(mascot).toHaveAttribute("data-wear", "outfit");
  for (const slot of ["hat", "top", "bottom"])
    await expect(
      mascot.locator(`image[data-layer^="${slot}:"]`).first(),
    ).toBeAttached();
  await expect(mascot.locator("[data-hamster-warnings]")).toHaveCount(0);
  // Load the real PNGs too: present DOM layers alone do not prove the clothes display.
  await mascot.locator("image").evaluateAll(async (nodes) => {
    await Promise.all(
      nodes.map(async (node) => {
        const image = new Image();
        image.src = node.getAttribute("href")!;
        await image.decode();
        if (!image.naturalWidth) throw new Error("Missing outfit artwork");
      }),
    );
  });
}
async function publishChange(page: Page, userId = testUser.id) {
  await page.evaluate((userId) => {
    const channel = new BroadcastChannel("modu-auth-session");
    channel.postMessage({ type: "profile-changed", userId });
    channel.close();
  }, userId);
}

for (const variant of ["cream", "gray"] as const) {
  test(`${variant}: 로그인 후 모든 햄스터 영역에서 세 부위 의상을 표시한다`, async ({
    page,
  }, info) => {
    const api = await installApi(page, testRecord());
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/hamsters/wardrobe/catalog.json", (route) =>
      route.fulfill({ json: catalog }),
    );
    await page.route("**/api/v1/users/me/avatar/outfit", (route) =>
      route.fulfill({ json: dressed(variant) }),
    );
    await page.route("**/api/v1/measurements?*", (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    );
    await page.route("**/api/v1/workouts/history?*", (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    );
    const routine = routineFixture();
    routine.status = "completed";
    routine.progress.completedItems = routine.routine.length;
    for (const item of routine.routine) {
      item.status = item.resultStatus = "completed";
      item.completedAt = item.performedAt = routine.serverTime;
    }
    await page.route(`**/api/v2/workout-routines/${routine.id}`, (route) =>
      route.fulfill({ json: routine }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    const cases = [
      ["/", "basic"],
      ["/account", "basic"],
      ["/groups", "phone"],
      ["/measurements", "situp"],
      ["/onboarding", "curious"],
      ["/workout?mode=assessment", "situp"],
      [`/onboarding/complete?record=${testRecord().id}`, "victory"],
      ["/workout", "lying"],
      [
        `/workout-routines/${routine.id}/items/${routine.routine[0].id}`,
        "pushup",
      ],
      [`/workout-routines/${routine.id}/complete`, "victory"],
      [`/workout-routines/${routine.id}/complete/streak`, "passion"],
    ];
    for (const [path, pose] of cases) {
      await page.setViewportSize({
        width: pose === "pushup" ? 1280 : 390,
        height: 900,
      });
      await page.goto(path);
      await assertClothes(
        page.locator(`[data-pose="${pose}"]`).first(),
        variant,
        pose,
      );
    }
    await page.screenshot({
      path: info.outputPath(`clothed-streak-${variant}.png`),
      fullPage: true,
    });
    await page.goto("/welcome");
    for (const v of ["cream", "gray"] as const)
      await assertClothes(
        page.locator(`[data-variant="${v}"]`),
        v,
        variant === v ? "victory" : "basic",
      );
    await page.goto("/account/settings?tab=delete");
    const form = page.getByRole("form", { name: "회원 탈퇴", exact: true });
    await form
      .getByLabel("현재 비밀번호", { exact: true })
      .fill("not-submitted-password");
    await form.getByRole("button", { name: "회원 탈퇴", exact: true }).click();
    await assertClothes(
      page.getByRole("dialog").locator("[data-pose]"),
      variant,
      "cant-hear",
    );
    await page.getByRole("button", { name: "취소", exact: true }).click();
    expect(api.mutations).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("다른 그룹원의 코디는 내 코디와 구분해서 표시한다", async ({ page }) => {
  await installApi(page, testRecord());
  await page.route("**/hamsters/wardrobe/catalog.json", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.route("**/api/v1/users/me/avatar/outfit", (route) =>
    route.fulfill({ json: dressed("gray") }),
  );
  const group = homeGroup();
  group.members[1].profileCharacter = dressed("cream");
  await installHomeGroups(page, [group]);
  await page.goto("/");
  await assertClothes(
    page.getByRole("img", { name: "나의 대표 캐릭터", exact: true }),
    "gray",
    "basic",
  );
  await assertClothes(
    page.getByRole("img", {
      name: `${group.members[1].nickname}의 햄스터`,
      exact: true,
    }),
    "cream",
    "basic",
  );
  await expect(
    page.getByRole("img", {
      name: `${group.members[2].nickname}의 햄스터`,
      exact: true,
    }),
  ).toHaveAttribute("data-wear", "none");
});

test("구매와 저장 후 화면 이동 및 열린 탭의 코디 변경도 새로고침 없이 반영한다", async ({
  page,
}) => {
  const state = await installCommerce(page);
  let reads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().endsWith("/users/me/avatar/outfit")
    )
      reads++;
  });
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "나의 대표 캐릭터", exact: true }),
  ).toHaveAttribute("data-wear", "none");
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "상점", exact: true })
    .click();
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page.getByRole("button", { name: /민트 티셔츠.*25개/ }).click();
  await page
    .getByRole("button", { name: "민트 티셔츠 구매하기", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "구매할까요?" })
    .getByRole("button", { name: "구매 확정", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "내 옷장", exact: true }).click();
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page.getByRole("button", { name: /민트 티셔츠.*보유 중/ }).click();
  await page.getByRole("button", { name: "코디 저장", exact: true }).click();
  await expect(page.getByText("대표 코디를 저장했어요.")).toBeVisible();
  expect(state.outfit.clothingIds).toEqual(["clothing.mint-shirt"]);
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "내 그룹", exact: true })
    .click();
  await expect(page).toHaveURL("/groups");
  await expect(
    page.getByRole("heading", { name: "내 그룹", exact: true }),
  ).toBeVisible();
  // This fixture supports only basic: keep a complete clothed pose instead of bare phone.
  const mascot = page.locator('[data-pose="basic"][data-wear="outfit"]');
  await expect(mascot).toBeVisible();
  await expect(mascot.locator('image[data-layer^="top:"]')).toHaveAttribute(
    "href",
    shirtAssets.cream,
  );
  state.outfit = dressed("gray");
  // A different member's event must not invalidate this session.
  const before = reads;
  await publishChange(page, "someone-else");
  await publishChange(page);
  // Already loaded catalog deliberately cannot render new garments: no silent bare avatar.
  await expect(page.getByText("코디 이미지 준비 중")).toBeVisible();
  await expect.poll(() => reads).toBe(before + 1);
  state.outfit = {
    ...state.outfit,
    clothingIds: ["clothing.mint-shirt"],
    rendering: {
      variant: "gray",
      pose: "basic",
      clothing: [state.outfit.rendering.clothing[1]],
    },
  };
  await publishChange(page);
  await expect(mascot).toHaveAttribute("data-variant", "gray");
  state.outfit = {
    ...state.outfit,
    clothingIds: [],
    rendering: { variant: "gray", pose: "basic", clothing: [] },
  };
  await publishChange(page);
  await expect(
    page.locator('[data-pose="phone"][data-variant="gray"]'),
  ).toHaveAttribute("data-wear", "none");
});

test("코디와 의상 로딩이 늦어도 캐릭터가 준비된 뒤 완료 애니메이션을 시작한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.route("**/hamsters/wardrobe/catalog.json", (route) =>
    route.fulfill({ json: catalog }),
  );
  const routine = routineFixture();
  routine.status = "completed";
  routine.progress.completedItems = routine.routine.length;
  for (const item of routine.routine) {
    item.status = item.resultStatus = "completed";
    item.completedAt = item.performedAt = routine.serverTime;
  }
  await page.route(`**/api/v2/workout-routines/${routine.id}`, (route) =>
    route.fulfill({ json: routine }),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/users/me/avatar/outfit", async (route) => {
    await pending;
    return route.fulfill({ json: dressed("gray") });
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.hasAttribute("data-completion-motion")) animation.pause();
      return animation;
    };
  });
  try {
    await page.goto(`/workout-routines/${routine.id}/complete`);
    await expect(
      page.getByRole("heading", { name: "오늘의 운동 완료!" }),
    ).toBeVisible();
    const motion = page.locator('[data-completion-motion="jump"]');
    expect(await motion.evaluate((node) => node.getAnimations().length)).toBe(
      0,
    );
    await expect(
      page.getByRole("button", { name: "다음", exact: true }),
    ).toBeDisabled();
    release();
    await assertClothes(
      page.getByRole("img", { name: "운동을 마친 햄스터" }),
      "gray",
      "victory",
    );
    await expect
      .poll(() => motion.evaluate((node) => node.getAnimations().length))
      .toBe(1);
    await motion.evaluate((node) => node.getAnimations()[0].finish());
    await expect(
      page.getByRole("link", { name: "다음", exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});

test("코디와 의상 조회 실패를 재시도하면 옷을 벗기지 않고 복구한다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  let outfitFails = true,
    catalogFails = true;
  await page.route("**/api/v1/users/me/avatar/outfit", (route) =>
    outfitFails
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: dressed("gray") }),
  );
  await page.route("**/hamsters/wardrobe/catalog.json", (route) =>
    catalogFails
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: catalog }),
  );
  await page.goto("/groups");
  await expect(
    page.getByRole("button", { name: "내 햄스터 다시 불러오기" }),
  ).toBeVisible();
  await expect(page.locator("[data-pose]")).toHaveCount(0);
  outfitFails = false;
  await page.getByRole("button", { name: "내 햄스터 다시 불러오기" }).click();
  await expect(
    page.getByRole("button", { name: "의상 다시 불러오기" }),
  ).toBeVisible();
  await expect(page.locator("[data-pose]")).toHaveCount(0);
  catalogFails = false;
  await page.getByRole("button", { name: "의상 다시 불러오기" }).click();
  await assertClothes(page.locator("[data-pose]"), "gray", "phone");
});
