import { expect, type Page } from "@playwright/test";
export async function prepareAssessment(page: Page) {
  await expect(page.getByLabel("측정 당시 나이")).toContainText("만 25세");
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
