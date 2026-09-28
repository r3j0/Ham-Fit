import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import {
  gripRecordFixture,
  gripCatalogFixture,
} from "../fixtures/grip-evaluation";

test("절대악력은 kg으로 입력하고 측정 당시 체중을 추가해 원본 그대로 제출한다", async ({
  page,
}) => {
  const server = await installApi(page, undefined, gripCatalogFixture);
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
    .filter({ hasText: "절대악력" })
    .click();
  await page.locator("#value-absolute_grip_strength").fill("30");
  await expect(page.getByText(/체중이 없으면 절대악력만 저장/)).toBeVisible();
  await page.getByRole("button", { name: "측정 당시 체중 추가" }).click();
  await page.locator("#value-weight").fill("50");
  await expect(page.getByText(/체중이 없으면 절대악력만 저장/)).toHaveCount(0);
  await page.getByRole("button", { name: "2개 항목 저장하기" }).click();
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  expect(server.mutations.find((m) => m.method === "POST")?.body).toMatchObject(
    {
      items: [
        { measurementCode: "absolute_grip_strength", value: "30", unit: "kg" },
        { measurementCode: "weight", value: "50", unit: "kg" },
      ],
    },
  );
});

test("근력 리포트는 원본 kg, 환산 %, 적용 기준과 다음 목표를 구분한다", async ({
  page,
}) => {
  const record = gripRecordFixture();
  await installApi(page, record, gripCatalogFixture);
  await page.goto(`/measurements/${record.id}`);
  await page.locator('summary[aria-label^="근력 · 2등급"]').click();
  await expect(
    page.getByText("등급 판정에 사용한 상대악력: 60 %"),
  ).toBeVisible();
  await page.getByText("환산 과정 보기", { exact: true }).click();
  await expect(
    page.getByText("절대악력 30 kg ÷ 같은 기록의 체중 50 kg × 100"),
  ).toBeVisible();
  await expect(
    page.getByText("현재 값과의 차이 2.4 %p · 증가 필요"),
  ).toBeVisible();
  await expect(
    page.getByText("평가 정보를 확인하지 못했어요.", { exact: false }),
  ).toHaveCount(0);
  await expect(page.locator(".radar-point")).toHaveCount(6);
});

test("사진 추출의 절대악력 kg과 체중을 검토하고 원본 단위로 저장한다", async ({
  page,
}) => {
  const server = await installApi(page, undefined, gripCatalogFixture);
  await page.route("**/measurements/extract", (r) =>
    r.fulfill({
      json: {
        catalogVersion: gripCatalogFixture.version,
        status: "extracted",
        metadata: {
          measuredOn: "2026-09-01",
          ageAtMeasurement: 25,
          sexAtMeasurement: "male",
          centerName: null,
          reportedOverallGrade: null,
        },
        items: [
          {
            measurementCode: "absolute_grip_strength",
            value: "30",
            unit: "kg",
            reportedGrade: null,
            evidence: { label: "악력", value: "30", unit: "kg" },
          },
          {
            measurementCode: "weight",
            value: "50",
            unit: "kg",
            reportedGrade: null,
            evidence: { label: "체중", value: "50", unit: "kg" },
          },
        ],
        reviewItems: [],
        issues: [],
        notDetectedMeasurementCodes: [],
      },
    }),
  );
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles({
    name: "report.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "측정값 읽기" }).click();
  await page.getByRole("button", { name: "결과표 확정" }).click();
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(page.locator("#value-absolute_grip_strength")).toHaveValue("30");
  await expect(page.locator("#value-weight")).toHaveValue("50");
  expect(server.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "2개 항목 저장하기" }).click();
  await expect(page).toHaveURL(/\/onboarding\/complete\?record=/);
  expect(
    server.record?.items.map((i) => [i.measurementCode, i.value, i.unit]),
  ).toEqual([
    ["absolute_grip_strength", "30", "kg"],
    ["weight", "50", "kg"],
  ]);
});
