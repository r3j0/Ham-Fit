import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import {
  stepRecordFixture,
  stepCatalogFixture,
} from "../fixtures/step-evaluation";
test("스텝검사 리포트는 원본 bpm과 참고 등급·환산 근거·VO2 목표를 표시한다", async ({
  page,
}, info) => {
  const record = stepRecordFixture();
  await installApi(page, record, stepCatalogFixture);
  await page.goto(`/measurements/${record.id}`);
  await page.locator('summary[aria-label^="심폐지구력 · 2등급"]').click();
  await expect(
    page.getByLabel("추정 최대산소섭취량: 42.527 ml/kg/min", { exact: true }),
  ).toBeVisible();
  await page.getByText("환산 과정 보기", { exact: true }).click();
  await expect(
    page.getByText(
      /측정 당시 남성 · 만 25세 · 신장 170 cm · 체중 65 kg · 회복 심박수 140 bpm/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("현재 값과의 차이 2.273 ml/kg/min · 증가 필요"),
  ).toBeVisible();
  await expect(
    page.getByText("심폐지구력은 자가측정 기반 참고 등급이에요."),
  ).toBeVisible();
  await expect(page.getByText(/평가 정보를 확인하지 못했어요/)).toHaveCount(0);
  await expect(page.locator(".radar-point")).toHaveCount(6);
  await page.screenshot({
    path: info.outputPath("step-reference-report.png"),
    fullPage: true,
    animations: "disabled",
  });
});
