import { test, expect } from "@playwright/test";
import { installCommerce } from "./avatar-rewards-fixtures";

for (const width of [320, 600, 1218]) {
  test(`${width}px 상점은 미리보기 위 중앙에 옷장 버튼을 표시하고 옷장은 뒤로가기로 상점에 돌아간다`, async ({
    page,
  }, info) => {
    await installCommerce(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/shop");
    const stage = page.getByRole("region", { name: "코디 미리보기" });
    const wardrobe = stage.getByRole("link", { name: "내 옷장", exact: true });
    await expect(wardrobe).toBeVisible();
    await expect(wardrobe).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(wardrobe).toHaveCSS("border-top-width", "1px");
    await expect(
      page.locator(".page-header").getByRole("link", { name: "내 옷장" }),
    ).toHaveCount(0);
    const box = (await stage.boundingBox())!,
      button = (await wardrobe.boundingBox())!,
      character = (await stage
        .getByRole("img", { name: "내 캐릭터 미리보기" })
        .boundingBox())!;
    expect(button.x + button.width / 2).toBeCloseTo(box.x + box.width / 2, 1);
    expect(button.y).toBeGreaterThan(box.y);
    expect(button.y + button.height).toBeLessThanOrEqual(character.y);
    expect(button.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: info.outputPath(`shop-navigation-${width}.png`),
      fullPage: true,
    });
    await wardrobe.click();
    await expect(page).toHaveURL("/shop/wardrobe");
    await expect(
      page.getByRole("heading", { name: "내 옷장", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".header-right").getByRole("link")).toHaveCount(
      0,
    );
    const back = page.getByRole("link", { name: "이전 화면", exact: true });
    await expect(back).toHaveAttribute("href", "/shop");
    await page.goto("/shop/wardrobe");
    await back.click();
    await expect(page).toHaveURL("/shop");
    await expect(wardrobe).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
