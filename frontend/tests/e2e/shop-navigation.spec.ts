import { test, expect } from "@playwright/test";
import { installCommerce } from "./avatar-rewards-fixtures";

for (const width of [320, 600, 1218]) {
  test(`${width}px 상점·옷장의 재화는 미리보기 하단 중앙에 표시하고 옷장은 뒤로가기로 상점에 돌아간다`, async ({
    page,
  }, info) => {
    const state = await installCommerce(page);
    state.balance = 999999999;
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/shop");
    const stage = page.getByRole("region", { name: "코디 미리보기" });
    const wardrobe = stage.getByRole("link", { name: "내 옷장", exact: true });
    const balance = stage.getByRole("group", { name: "보유 재화" });
    async function checkBalance() {
      await expect(page.getByRole("group", { name: "보유 재화" })).toHaveCount(
        1,
      );
      await expect(balance).toHaveText("999,999,999");
      const box = (await stage.boundingBox())!,
        money = (await balance.boundingBox())!,
        character = (await stage
          .getByRole("img", { name: "내 캐릭터 미리보기" })
          .boundingBox())!;
      expect(money.x + money.width / 2).toBeCloseTo(box.x + box.width / 2, 1);
      expect(money.x).toBeGreaterThan(box.x);
      expect(money.x + money.width).toBeLessThan(box.x + box.width);
      expect(money.y).toBeGreaterThanOrEqual(character.y + character.height);
      expect(box.y + box.height - (money.y + money.height)).toBeCloseTo(23, 1);
      for (const control of [
        stage.getByRole("button", { name: "초기화" }),
        stage.getByRole("group", { name: "캐릭터 선택" }),
      ]) {
        if (await control.count()) {
          const controlBox = (await control.boundingBox())!;
          expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(money.y);
        }
      }
    }

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
    await checkBalance();
    await page.getByRole("button", { name: "상의", exact: true }).click();
    await page.getByRole("button", { name: /민트 티셔츠.*25개/ }).click();
    await expect(stage.getByRole("button", { name: "초기화" })).toBeVisible();
    await checkBalance();
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
    await checkBalance();
    await page.screenshot({
      path: info.outputPath(`wardrobe-balance-${width}.png`),
      fullPage: true,
    });
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
