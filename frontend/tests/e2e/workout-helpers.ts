import { expect, type Page } from "@playwright/test";
export async function prepareAssessment(page: Page) {
  await page.getByLabel("만 나이", { exact: true }).fill("25");
  await page.getByRole("button", { name: "측정 준비 완료" }).click();
  await expect(
    page.getByRole("button", { name: "측정 시작", exact: true }),
  ).toBeVisible();
}
export async function skipToFlexibility(page: Page) {
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page.getByRole("button", { name: "측정값 입력", exact: true }).click();
}
