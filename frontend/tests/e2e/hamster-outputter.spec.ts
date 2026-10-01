import { expect, test } from "@playwright/test";
import { POSES } from "../../components/hamster/poses";
import { installCommerce, products } from "./avatar-rewards-fixtures";

test("32개 원본 자세를 브라우저에서 디코딩하고 저장 코디를 동일하게 표시한다", async ({
  page,
}) => {
  const state = await installCommerce(page, true);
  const errors: string[] = [];
  const legacyRequests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/mascots/")) legacyRequests.push(r.url());
  });
  await page.goto("/");
  // Exercise the actual browser decoder for every shipped base, not only HTTP 200.
  const paths = Object.values(POSES).flatMap((p) => [
    p.assets.cream.src,
    p.assets.gray.src,
  ]);
  await page.evaluate(async (sources) => {
    for (const src of sources) {
      const image = new Image();
      image.src = src;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(src);
    }
  }, paths);
  for (const [variant, pose] of [
    ["gray", "foam-roller"],
    ["cream", "phone"],
    ["gray", "toilet"],
    ["cream", "weight"],
  ] as const) {
    state.outfit = {
      ...state.outfit,
      characterId: `character.${variant}`,
      poseId: `pose.${pose}`,
      rendering: { variant, pose, clothing: [] },
    };
    await page.reload();
    const image = page.getByRole("img", {
      name: "나의 대표 캐릭터",
      exact: true,
    });
    await expect(image.locator('[data-layer="base"]')).toHaveAttribute(
      "href",
      `/hamsters/base/${pose}-${variant}.webp`,
    );
  }
  expect(errors).toEqual([]);
  expect(legacyRequests).toEqual([]);
});

test("티셔츠 선택은 자세 변경에도 유지되고 미지원 코디의 저장·구매는 차단된다", async ({
  page,
}, info) => {
  const state = await installCommerce(page, true);
  await page.goto("/shop/wardrobe");
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page.getByRole("button", { name: /민트 티셔츠.*보유 중/ }).click();
  await page.getByRole("button", { name: "코디 저장", exact: true }).click();
  await expect(page.getByText("대표 코디를 저장했어요.")).toBeVisible();
  expect(state.outfit.clothingIds).toEqual(["clothing.mint-shirt"]);
  await page.reload();
  const preview = page.getByRole("img", {
    name: "내 캐릭터 미리보기",
    exact: true,
  });
  await expect(preview.locator("image")).toHaveCount(2);
  await preview.locator("image").evaluateAll(async (nodes) => {
    for (const node of nodes) {
      const i = new Image();
      i.src = node.getAttribute("href")!;
      await i.decode();
    }
  });
  await page.screenshot({
    path: info.outputPath("mint-shirt-saved.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "자세", exact: true }).click();
  await page.getByRole("button", { name: /달리기.*보유 중/ }).click();
  await expect(
    page.getByText("이 코디의 이미지는 준비 중이에요."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "코디 저장", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /민트 티셔츠.*보유 중/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "자세", exact: true }).click();
  await page.getByRole("button", { name: /기본.*보유 중/ }).click();
  await expect(preview.locator("image")).toHaveCount(2);
  expect(state.puts).toBe(1);
  state.owned = state.owned.filter((id) => id !== "clothing.mint-shirt");
  await page.goto("/shop");
  await page.getByRole("button", { name: "초기화" }).click();
  await page.getByRole("button", { name: "자세", exact: true }).click();
  await page.getByRole("button", { name: /달리기.*보유 중/ }).click();
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page.getByRole("button", { name: /민트 티셔츠.*25개/ }).click();
  await expect(
    page.getByRole("button", { name: /민트 티셔츠 구매하기/ }),
  ).toBeDisabled();
  expect(state.purchases).toHaveLength(0);
});

test("제외된 스포츠웨어는 목록에 없으며 a-plus 코디에서도 옷장을 복구할 수 있다", async ({
  page,
}) => {
  const state = await installCommerce(page);
  state.outfit.poseId = "pose.a-plus";
  state.outfit.rendering.pose = "a-plus";
  const legacy = {
    ...products.find((p) => p.kind === "clothing")!,
    id: "clothing.blue-sportswear",
    renderKey: "blue-sportswear",
  };
  await page.route("**/api/v1/shop/products", (route) =>
    route.fulfill({
      json: {
        products: [...products, legacy],
        combinations: ["cream", "gray"].map((v) => ({
          characterId: `character.${v}`,
          poseId: "pose.basic",
          clothingIds: [],
        })),
      },
    }),
  );
  await page.goto("/shop");
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await expect(page.locator(".shop-item")).toHaveCount(1);
  await expect(
    page.getByText("이 코디의 이미지는 준비 중이에요."),
  ).toBeVisible();
  await page.getByRole("link", { name: "내 옷장", exact: true }).click();
  await page.getByRole("button", { name: "자세", exact: true }).click();
  await page.getByRole("button", { name: /기본.*보유 중/ }).click();
  await page.getByRole("button", { name: "코디 저장", exact: true }).click();
  await expect(page.getByText("대표 코디를 저장했어요.")).toBeVisible();
  expect(state.outfit.poseId).toBe("pose.basic");
});
