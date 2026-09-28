import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";

test("간이측정은 평가에 필요한 정보를 안내하면서 건너뛰기를 유지한다", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/workout?mode=assessment");
  await expect(
    page.getByText(/스텝검사 평가에 필요한 정보: 성별 · 신장 · 체중/),
  ).toBeVisible();
  await page.getByLabel("만 나이", { exact: true }).fill("25");
  await page.getByRole("button", { name: "측정 준비 완료" }).click();
  await expect(
    page.getByRole("button", { name: "측정 시작", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page.getByRole("button", { name: "이 항목 건너뛰기" }).click();
  await page.getByRole("button", { name: "측정값 입력", exact: true }).click();
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("5");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(page.getByText(/스텝검사 평가에 필요한 정보/)).toHaveCount(0);
});

test("직접 입력은 심박수 원본을 유지하고 환산에 필요한 신장·체중을 추가한다", async ({
  page,
}) => {
  const server = await installApi(page);
  await page.goto("/onboarding/manual");
  await page.locator("#measuredOn").fill("2026-09-01");
  await page.locator("#age").fill("25");
  await page.getByLabel("성별", { exact: true }).selectOption("male");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: "YMCA 회복 심박수" })
    .click();
  await page.locator("#value-ymca_recovery_heart_rate").fill("90");
  await page.getByRole("button", { name: "측정 당시 신장 추가" }).click();
  await page.locator("#value-height").fill("170");
  await page.getByRole("button", { name: "측정 당시 체중 추가" }).click();
  await page.locator("#value-weight").fill("65");
  await expect(page.getByText(/스텝검사 평가에 필요한 정보:/)).toHaveCount(0);
  await page.getByRole("button", { name: "3개 항목 저장하기" }).click();
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  expect(server.mutations.find((m) => m.method === "POST")?.body).toMatchObject(
    {
      sexAtMeasurement: "male",
      items: [
        {
          measurementCode: "ymca_recovery_heart_rate",
          value: "90",
          unit: "bpm",
        },
        { measurementCode: "height", value: "170", unit: "cm" },
        { measurementCode: "weight", value: "65", unit: "kg" },
      ],
    },
  );
});
